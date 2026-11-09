/**
 * check:thongnhat2fa — MỘT cổng 2FA ở POST /auth/login (09/11/2026, chủ shop chọn "phương án B").
 *
 * Trước đó /login có HAI cổng dùng chung cờ twoFactorEnabled:
 *   - cổng OTP email chạy TRƯỚC, hễ máy chủ có SMTP_USER (prod CÓ) ⇒ người bật Google Authenticator chỉ bị hỏi mã
 *     email, hạt TOTP thành đồ trang trí; mã email + bộ đếm sai nằm trong RAM (prod tới 3 bản Cloud Run, không Redis);
 *   - POST /send-otp purpose login_2fa chỉ cần email + mã cửa hàng ⇒ ai biết email người bật 2FA là xin được mã, rồi
 *     POST /verify-otp cấp phiên KHÔNG cần mật khẩu;
 *   - "thiết bị tin cậy" = chuỗi client tự chọn: web gửi vân tay 'dev_…' đoán được, Android 1.0.46 gửi hằng
 *     'android_dev' — một khoá vượt CHUNG cho mọi máy; GET /trusted-devices trả nguyên các khoá đó.
 * Nay: có hạt TOTP ⇒ CHỈ mã app; cờ bật mà không hạt ⇒ mã email gắn với lần đăng nhập đã qua mật khẩu; mọi lần chờ ở
 * bảng Pending2FA; thiết bị tin cậy = token 32 byte máy chủ cấp (chỉ lưu băm, 30 ngày, client phải xin rememberDevice);
 * bật 2FA qua email = setup-2fa / confirm-2fa với method 'email'.
 *
 * Cách soát: chạy THẬT các tuyến của routes/auth.ts (authMiddleware thật cho tuyến cần đăng nhập) trên prisma GIẢ cài
 * vào require.cache TRƯỚC khi nạp router — registry (Store, Pending2FA, RefreshToken) lẫn schema cửa hàng (User,
 * Branch, StoreSettings) — và hộp thư giả thay sendEmail. Không chạm CSDL thật, không gửi email thật. Truy vấn lạ ⇒
 * ghi lại + ném lỗi (ca cuối đỏ). Mọi phản hồi đều bị soi: không được chứa hạt TOTP, hash mật khẩu, băm mã email hay
 * băm token thiết bị. "Nhiều bản Cloud Run": nạp router lần hai (module mới, RAM mới) trên CÙNG CSDL giả — đăng nhập
 * ở bản A, nhập mã / gửi lại mã ở bản B.
 *
 * Chạy: npm run check:thongnhat2fa
 */
import Module from 'module'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

let soCa = 0
let loi = 0
/** In khi hỏng: bỏ giá trị các trường token / băm / hạt (dù chỉ là giá trị thử). */
const AN = new Set(['token', 'refreshToken', 'deviceToken', 'loginToken', 'codeHash', 'tokenHash', 'twoFactorSecret', 'password', 'secret', 'otpauthUrl'])
const tt = (x: unknown) => JSON.stringify(x, (k, v) => (AN.has(k) && typeof v === 'string' ? `…${v.length}` : v))?.slice(0, 700)
function dung(ten: string, dat: boolean, chiTiet?: unknown) {
    soCa++
    if (dat) { console.log(`  ✓ ${ten}`); return }
    loi++
    console.log(`  ✗ ${ten}`)
    if (chiTiet !== undefined) console.log(`      ${tt(chiTiet)}`)
}

// ─── CSDL giả ─────────────────────────────────────────────────────────────────
type Hang = Record<string, any>
const DB = {
    store: [] as Hang[],
    pending2FA: [] as Hang[],
    refreshToken: [] as Hang[],
    user: new Map<string, Hang[]>(), // schema → dòng User
}
const goiLa: string[] = []

const soSanh = (a: any, b: any) => (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b)
function khop(r: Hang, where: any): boolean {
    if (!where) return true
    for (const [k, v] of Object.entries(where)) {
        if (k === 'OR') { if (!(v as any[]).some(w => khop(r, w))) return false; continue }
        if (k === 'AND') { if (!(v as any[]).every(w => khop(r, w))) return false; continue }
        const cot = r[k]
        if (v === null) { if (cot !== null && cot !== undefined) return false; continue }
        if (v instanceof Date) { if (!(cot instanceof Date) || cot.getTime() !== v.getTime()) return false; continue }
        if (typeof v === 'object') {
            const dk = v as Record<string, any>
            const la = Object.keys(dk).filter(x => !['equals', 'mode', 'in', 'lt', 'lte', 'gt', 'gte', 'not'].includes(x))
            if (la.length) { goiLa.push(`điều kiện lạ ${k}: ${la.join(',')}`); throw new Error(`điều kiện lạ ${k}`) }
            if ('equals' in dk) {
                const a = String(cot ?? ''), b = String(dk.equals)
                if (dk.mode === 'insensitive' ? a.toLowerCase() !== b.toLowerCase() : a !== b) return false
            }
            if ('in' in dk && !dk.in.includes(cot)) return false
            if ('lt' in dk && !(cot != null && soSanh(cot, dk.lt) < 0)) return false
            if ('lte' in dk && !(cot != null && soSanh(cot, dk.lte) <= 0)) return false
            if ('gt' in dk && !(cot != null && soSanh(cot, dk.gt) > 0)) return false
            if ('gte' in dk && !(cot != null && soSanh(cot, dk.gte) >= 0)) return false
            if ('not' in dk && cot === dk.not) return false
            continue
        }
        if (cot !== v) return false
    }
    return true
}
function apDung(r: Hang, data: Hang) {
    for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) r[k] = (r[k] ?? 0) + v.increment
        else if (v !== undefined) r[k] = v
    }
}
/** Như Prisma: có select thì CHỈ trả các cột được chọn (prisma giả không theo select từng báo oan 1.944 đơn). */
const chon = (r: Hang, select?: Record<string, any>) =>
    select ? Object.fromEntries(Object.entries(select).filter(([, v]) => v).map(([k]) => [k, r[k]])) : { ...r }
function sapXep(ds: Hang[], orderBy: any): Hang[] {
    if (!orderBy) return ds
    const tieuChi = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: Hang) => Object.entries(o))
    return [...ds].sort((a, b) => {
        for (const [k, chieu] of tieuChi) {
            const d = soSanh(a[k] ?? 0, b[k] ?? 0)
            if (d) return chieu === 'desc' ? -d : d
        }
        return 0
    })
}
const chanLa = (ten: string) => (o: any, k: string | symbol) => {
    if (typeof k === 'symbol' || k === 'then') return undefined
    if (k in o) return o[k]
    goiLa.push(`${ten}${String(k)}`)
    throw new Error(`truy vấn lạ: ${ten}${String(k)}`)
}
function bangGia(ten: string, layHang: () => Hang[], taoDong: (d: Hang) => Hang = d => d) {
    const lam: Record<string, Function> = {
        findUnique: async ({ where, select }: any) => { const r = layHang().find(h => khop(h, where)); return r ? chon(r, select) : null },
        findFirst: async ({ where, select, orderBy }: any = {}) => {
            const r = sapXep(layHang().filter(h => khop(h, where)), orderBy)[0]
            return r ? chon(r, select) : null
        },
        findMany: async ({ where, select, orderBy }: any = {}) => sapXep(layHang().filter(h => khop(h, where)), orderBy).map(h => chon(h, select)),
        create: async ({ data, select }: any) => { const r = taoDong({ ...data }); layHang().push(r); return chon(r, select) },
        update: async ({ where, data, select }: any) => {
            const r = layHang().find(h => khop(h, where))
            if (!r) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' })
            apDung(r, data)
            return chon(r, select)
        },
        updateMany: async ({ where, data }: any) => { const ds = layHang().filter(h => khop(h, where)); ds.forEach(r => apDung(r, data)); return { count: ds.length } },
        deleteMany: async ({ where }: any = {}) => {
            const h = layHang()
            const truoc = h.length
            for (let i = h.length - 1; i >= 0; i--) if (khop(h[i], where)) h.splice(i, 1)
            return { count: truoc - h.length }
        },
    }
    return new Proxy(lam, { get: chanLa(`${ten}.`) })
}

const registryGia: any = new Proxy({
    store: bangGia('store', () => DB.store),
    pending2FA: bangGia('pending2FA', () => DB.pending2FA, d => {
        if (DB.pending2FA.some(p => p.loginToken === d.loginToken)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
        return { id: 'p_' + crypto.randomBytes(6).toString('hex'), attempts: 0, createdAt: new Date(), method: null, codeHash: null, sentAt: null, ...d }
    }),
    refreshToken: bangGia('refreshToken', () => DB.refreshToken, d => ({ id: 'r_' + crypto.randomBytes(6).toString('hex'), createdAt: new Date(), ...d })),
    $queryRawUnsafe: async (sql: string, ...thamSo: unknown[]) => {
        if (/FROM "Store" WHERE LOWER\(code\) = \$1/.test(sql)) return DB.store.filter(s => s.code.toLowerCase() === thamSo[0]).slice(0, 1).map(s => ({ ...s }))
        goiLa.push(`registry.$queryRawUnsafe: ${sql.slice(0, 60)}`)
        throw new Error('SQL lạ')
    },
} as Record<string, any>, { get: chanLa('registry.') })

const cuaHangGia = new Map<string, any>()
function getStorePrismaGia(schema: string) {
    let p = cuaHangGia.get(schema)
    if (!p) {
        p = new Proxy({
            user: bangGia(`${schema}.user`, () => { if (!DB.user.has(schema)) DB.user.set(schema, []); return DB.user.get(schema)! }),
            branch: bangGia(`${schema}.branch`, () => []),
            storeSettings: bangGia(`${schema}.storeSettings`, () => []),
        } as Record<string, any>, { get: chanLa(`${schema}.`) })
        cuaHangGia.set(schema, p)
    }
    return p
}

// ─── Cài module giả TRƯỚC khi nạp router ─────────────────────────────────────
process.env.JWT_SECRET = 'khoa-thu-check-thong-nhat-2fa'
process.env.DATABASE_URL = 'postgresql://khong-dung-db@127.0.0.1:9/khong' // phòng hờ: bộ soát không bao giờ chạm CSDL thật
delete process.env.REDIS_URL
const NODE_ENV_GOC = process.env.NODE_ENV
const SMTP_GOC = process.env.SMTP_USER
process.env.NODE_ENV = 'test'

function caiModuleGia(duong: string, xuat: Record<string, unknown>) {
    const ten = require.resolve(duong)
    const m: any = new (Module as any)(ten, module)
    m.filename = ten
    m.loaded = true
    m.exports = xuat
    ;(require.cache as any)[ten] = m
}
caiModuleGia('../src/lib/prisma', {
    __esModule: true,
    default: registryGia,
    registryPrisma: registryGia,
    getStorePrisma: getStorePrismaGia,
    branchIdToSchema: (id: string) => `branch_${id}`,
    storeCodeToSchema: (id: string) => `branch_${id}`,
    createBranchSchema: async () => { goiLa.push('createBranchSchema'); throw new Error('không dùng trong ca thử') },
    dropBranchSchema: async () => { goiLa.push('dropBranchSchema'); throw new Error('không dùng trong ca thử') },
    laLoiMatKetNoi: () => false,
    giuClient: async (f: () => unknown) => f(),
})

const hopThu: Array<{ to: string; subject: string; text: string }> = []
let emailHong = false
const emailThat = require('../src/services/emailService')
;(require.cache as any)[require.resolve('../src/services/emailService')].exports = {
    __esModule: true,
    ...emailThat,
    sendEmail: async (to: string, subject: string, _html: string, text?: string) => {
        if (emailHong) throw new Error('SMTP giả hỏng')
        hopThu.push({ to, subject, text: text || '' })
        return { messageId: 'gia' }
    },
}

/** Nạp routes/auth.ts MỚI (RAM mới — như một bản Cloud Run khác) trên cùng CSDL giả. */
function napRouter(): any {
    for (const d of ['../src/routes/auth', '../src/lib/otp', '../src/lib/trustedDevice']) delete (require.cache as any)[require.resolve(d)]
    return require('../src/routes/auth').default
}

// ─── Gọi tuyến ────────────────────────────────────────────────────────────────
const cacBuoc = (router: any, method: string, duong: string): Function[] =>
    router.stack.find((l: any) => l.route?.path === duong && l.route.methods[method])?.route.stack.map((l: any) => l.handle) || []
const resGia = () => ({ ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } })

const BI_MAT: string[] = [] // chuỗi không bao giờ được xuất hiện trong phản hồi
const lo: string[] = []
function soiLo(duong: string, than: unknown) {
    const s = JSON.stringify(than ?? null)
    const cacBam = [
        ...DB.pending2FA.map(p => p.codeHash).filter(Boolean),
        ...[...DB.user.values()].flat().flatMap(u => { try { return (JSON.parse(u.trustedDevices || '[]') as Hang[]).map(d => d.tokenHash).filter(Boolean) } catch { return [] } }),
    ]
    for (const b of [...BI_MAT, ...cacBam]) if (b && s.includes(b)) lo.push(`${duong}: lộ ${String(b).slice(0, 6)}…`)
}

type TuyChon = { body?: any; headers?: Record<string, string>; params?: Record<string, string>; jwt?: Record<string, unknown> }
async function goi(router: any, method: 'get' | 'post' | 'put' | 'delete', duong: string, opt: TuyChon = {}) {
    const buoc = cacBuoc(router, method, duong)
    if (!buoc.length) throw new Error(`không thấy tuyến ${method} ${duong}`)
    const headers: Record<string, string> = { 'user-agent': 'Mozilla/5.0 (ca thử)', ...(opt.headers || {}) }
    if (opt.jwt) headers.authorization = `Bearer ${jwt.sign(opt.jwt, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' })}`
    const req: any = { headers, method: method.toUpperCase(), originalUrl: `/api/auth${duong}`, url: duong, body: opt.body, params: opt.params || {}, ip: '127.0.0.1' }
    const res = resGia()
    for (const b of buoc) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
    soiLo(`${method.toUpperCase()} ${duong}`, res.than)
    return { ma: res.ma, than: res.than, data: res.than?.data }
}

// ─── Dữ liệu thử ─────────────────────────────────────────────────────────────
const MAT_KHAU = 'MatKhau@123'
const SCHEMA = 'store_shopthu'
const HEX64 = /^[0-9a-f]{64}$/
/** Thiết bị tin cậy KIỂU CŨ trong cột: id = 'android_dev' (Android 1.0.46) và vân tay web — từng là khoá vượt TOTP. */
const TB_CU = JSON.stringify([
    { id: 'android_dev', name: 'Android App', lastUsed: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'dev_1a2b3c4d', name: 'Chrome', lastUsed: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' },
])
let HASH = ''
let HAT = ''
let otplib: any

function datLai(nguoiDung: Hang[], demo: Hang[] = []) {
    DB.store = [
        { id: 'st1', code: 'SHOPTHU', name: 'Shop Thử', address: null, phone: null, status: 'active', schema: SCHEMA },
        { id: 'st2', code: 'KENGIONLINE', name: 'Demo', address: null, phone: null, status: 'active', schema: 'store_demo' },
    ]
    DB.pending2FA = []
    DB.refreshToken = []
    DB.user = new Map([[SCHEMA, nguoiDung.map(u => ({ ...u }))], ['store_demo', demo.map(u => ({ ...u }))]])
    hopThu.length = 0
    emailHong = false
}
const nguoi = (g: Hang = {}): Hang => ({
    id: 'u1', email: 'chu@shop.vn', username: null, password: HASH, name: 'Chủ shop', role: 'admin', phone: null, avatar: null,
    twoFactorEnabled: false, twoFactorSecret: null, trustedDevices: '[]', isLocked: false, branchId: null, permissions: '[]', ...g,
})
const nguoiTotp = (g: Hang = {}) => nguoi({ twoFactorEnabled: true, twoFactorSecret: HAT, trustedDevices: TB_CU, ...g })
const nguoiEmail = (g: Hang = {}) => nguoi({ twoFactorEnabled: true, twoFactorSecret: null, trustedDevices: TB_CU, ...g })
const u1 = () => DB.user.get(SCHEMA)!.find(u => u.id === 'u1')!
const JWT_U1 = { userId: 'u1', email: 'chu@shop.vn', role: 'admin', storeId: 'st1', storeCode: 'SHOPTHU', branchId: null, branchSchema: SCHEMA, storeSchema: SCHEMA, isMainBranch: true }

const dangNhap = (r: any, body: Hang = {}, headers?: Record<string, string>) =>
    goi(r, 'post', '/login', { body: { email: 'chu@shop.vn', password: MAT_KHAU, storeCode: 'shopthu', ...body }, headers })
const maThuCuoi = () => hopThu[hopThu.length - 1]?.text.match(/mã bí mật của bạn nè: (\d{6})/)?.[1] || ''
const maApp = async () => String(await otplib.generate({ secret: HAT }))
const maKhac = (m: string) => String((Number(m) + 1) % 1_000_000).padStart(6, '0')
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const coPhien = (r: { ma: number; data: any }) => r.ma === 200 && typeof r.data?.token === 'string' && typeof r.data?.refreshToken === 'string'

async function chay() {
    otplib = await import('otplib')
    HASH = await bcrypt.hash(MAT_KHAU, 4)
    HAT = otplib.generateSecret()
    BI_MAT.push(HASH, HAT)
    const A = napRouter()
    dung('nạp được router auth trên prisma giả', !!A && cacBuoc(A, 'post', '/login').length === 1)

    // ── 1. Không bật 2FA ─────────────────────────────────────────────────────
    {
        datLai([nguoi()])
        const r = await dangNhap(A)
        dung('không bật 2FA ⇒ /login cấp phiên ngay, không lần chờ, không email', coPhien(r) && DB.pending2FA.length === 0 && hopThu.length === 0, r)
    }

    // ── 2. Có hạt TOTP ⇒ CHỈ mã app ──────────────────────────────────────────
    {
        datLai([nguoiTotp()])
        const r = await dangNhap(A, { deviceId: 'android_dev', deviceToken: 'android_dev' })
        const p = DB.pending2FA[0]
        dung('có hạt TOTP ⇒ /login hỏi mã APP (requireTwoFactor, method totp), KHÔNG gửi email, chưa cấp phiên',
            r.ma === 200 && r.data?.requireTwoFactor === true && r.data?.method === 'totp' && HEX64.test(r.data?.loginToken)
            && !r.data?.token && !r.data?.requiresOtp && hopThu.length === 0 && DB.pending2FA.length === 1 && p?.method === 'totp' && p?.codeHash === null, r)
        dung("deviceId/deviceToken 'android_dev' (Android 1.0.46) KHÔNG còn vượt TOTP dù cột có mục id 'android_dev'", r.data?.requireTwoFactor === true, r)
        const r2 = await dangNhap(A, { deviceId: 'dev_1a2b3c4d', deviceToken: 'dev_1a2b3c4d' })
        dung("vân tay web 'dev_…' KHÔNG còn vượt TOTP", r2.data?.requireTwoFactor === true && !r2.data?.token, r2)
        const r3 = await dangNhap(A, {}, { 'x-device-token': 'android_dev' })
        dung("header x-device-token 'android_dev' KHÔNG vượt TOTP", r3.data?.requireTwoFactor === true && !r3.data?.token, r3)
        dung('mỗi lần /login mới thay lần chờ cũ (còn đúng 1 dòng chờ)', DB.pending2FA.length === 1 && DB.pending2FA[0].loginToken === r3.data?.loginToken, DB.pending2FA.length)
        const loginToken = r3.data.loginToken

        // Đường email KHÔNG mở được tài khoản có hạt TOTP
        const s1 = await goi(A, 'post', '/send-otp', { body: { email: 'chu@shop.vn', storeCode: 'shopthu', purpose: 'login_2fa' } })
        dung('lỗ cũ: send-otp login_2fa chỉ email + mã cửa hàng (không mật khẩu) ⇒ 400, không gửi email', s1.ma === 400 && hopThu.length === 0, s1)
        const s2 = await goi(A, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken } })
        dung('send-otp với loginToken của lần chờ TOTP ⇒ 400, không gửi email', s2.ma === 400 && hopThu.length === 0, s2)
        const v1 = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', email: 'chu@shop.vn', storeCode: 'shopthu', code: '123456' } })
        dung('verify-otp login_2fa kiểu cũ (email + mã cửa hàng) với người dùng TOTP ⇒ 400, không cấp phiên', v1.ma === 400 && !v1.data?.token, v1)
        const v2 = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken, code: await maApp() } })
        dung('verify-otp với loginToken của lần chờ TOTP (kể cả mã app đúng) ⇒ 400 "cần mã từ ứng dụng", không cấp phiên',
            v2.ma === 400 && !v2.data?.token && /ứng dụng xác thực/.test(v2.than?.error || ''), v2)
        dung('các lần thử qua đường email KHÔNG tiêu lượt của lần chờ TOTP', DB.pending2FA[0]?.attempts === 0, DB.pending2FA[0]?.attempts)

        // Sai mã: 5 lượt cho mỗi lần đăng nhập, đếm trên CSDL
        const dung5: number[] = []
        for (let i = 0; i < 4; i++) {
            const v = await goi(A, 'post', '/verify-2fa', { body: { loginToken, totpCode: maKhac(await maApp()) } })
            dung5.push(v.ma)
            if (i === 0) dung('verify-2fa sai mã ⇒ 401 "còn 4 lần thử"', v.ma === 401 && /còn 4 lần thử/.test(v.than?.error || ''), v)
        }
        dung('4 lần sai ⇒ đều 401, CSDL ghi attempts = 4', dung5.every(m => m === 401) && DB.pending2FA[0]?.attempts === 4, { dung5, attempts: DB.pending2FA[0]?.attempts })
        const v5 = await goi(A, 'post', '/verify-2fa', { body: { loginToken, totpCode: maKhac(await maApp()) } })
        dung('lần sai thứ 5 ⇒ 429, lần chờ bị xoá', v5.ma === 429 && DB.pending2FA.length === 0, v5)
        const v6 = await goi(A, 'post', '/verify-2fa', { body: { loginToken, totpCode: await maApp() } })
        dung('hết lượt rồi thì mã ĐÚNG cũng không qua (401 đăng nhập lại)', v6.ma === 401 && !v6.data?.token, v6)
    }
    {
        datLai([nguoiTotp()])
        const { data } = await dangNhap(A)
        const vSai = await goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: 'abc' } })
        dung('mã app sai định dạng ("abc") ⇒ 401 như nhập sai (trước đây otplib ném lỗi ⇒ 500)', vSai.ma === 401 && DB.pending2FA[0]?.attempts === 1, vSai)
        const v = await goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: await maApp(), trustDevice: true, deviceId: 'dev_1a2b3c4d', deviceName: 'Chrome' } })
        dung('mã app đúng ⇒ cấp phiên, lưu refresh token, xoá lần chờ', coPhien(v) && DB.refreshToken.length === 1 && DB.pending2FA.length === 0, v)
        dung('không xin rememberDevice (client cũ chỉ gửi trustDevice) ⇒ không cấp deviceToken, cột thiết bị không đổi',
            v.data?.deviceToken === undefined && u1().trustedDevices === TB_CU, { v: v.data, cot: u1().trustedDevices.length })
        dung('phản hồi verify-2fa cùng hình dạng /login (user, store, branch)', !!v.data?.user?.id && v.data?.store?.code === 'SHOPTHU' && 'branch' in (v.data || {}), v)
        const lai = await goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: await maApp() } })
        dung('dùng lại loginToken đã qua ⇒ 401', lai.ma === 401 && !lai.data?.token, lai)
    }
    {
        datLai([nguoiTotp()])
        const { data } = await dangNhap(A)
        const ma = await maApp()
        const [x, y] = await Promise.all([
            goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: ma } }),
            goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: ma } }),
        ])
        dung('hai request cùng mã đúng cùng lúc ⇒ đúng MỘT phiên', [x, y].filter(coPhien).length === 1 && DB.refreshToken.length === 1, { x: x.ma, y: y.ma })
    }
    {
        datLai([nguoiTotp()])
        const { data } = await dangNhap(A)
        u1().isLocked = true
        const v = await goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: await maApp() } })
        dung('tài khoản bị khoá giữa lúc đăng nhập và nhập mã ⇒ 403, không phiên, xoá lần chờ', v.ma === 403 && !v.data?.token && DB.pending2FA.length === 0, v)
    }
    {
        datLai([nguoiTotp()])
        const { data } = await dangNhap(A)
        u1().twoFactorSecret = null // chuyển sang email giữa chừng
        const v = await goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: await maApp() } })
        dung('đổi cách 2FA giữa chừng ⇒ 401 đăng nhập lại, không phiên', v.ma === 401 && !v.data?.token, v)
    }
    {
        datLai([nguoiTotp()])
        const loginToken = crypto.randomBytes(32).toString('hex')
        DB.pending2FA.push({
            id: 'p_cu', loginToken, userId: 'u1', email: 'chu@shop.vn', role: 'admin', storeId: 'st1', storeCode: 'SHOPTHU', branchId: null,
            branchSchema: SCHEMA, isMainBranch: false, deviceId: null, userData: JSON.stringify({ id: 'u1' }), storeData: JSON.stringify({ code: 'SHOPTHU' }),
            branchData: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), method: null, codeHash: null, attempts: 0, sentAt: null,
        })
        const v = await goi(A, 'post', '/verify-2fa', { body: { loginToken, totpCode: await maApp() } })
        dung('dòng chờ tạo TRƯỚC bản này (method null) vẫn xác minh như TOTP', coPhien(v), v)
    }

    // ── 3. Thiết bị tin cậy: token máy chủ cấp, chỉ khi client xin ───────────
    {
        datLai([nguoiTotp()])
        const { data } = await dangNhap(A)
        const v = await goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: await maApp(), rememberDevice: true, deviceName: 'Chrome trên Windows' } })
        const tok = v.data?.deviceToken
        const cot: Hang[] = JSON.parse(u1().trustedDevices)
        dung('rememberDevice: true ⇒ trả deviceToken 64 hex + hạn 30 ngày', coPhien(v) && HEX64.test(tok) && v.data?.deviceTokenExpiresInDays === 30, v)
        dung('cột chỉ giữ BĂM token (không có token thô), mục kiểu cũ (android_dev, dev_…) rơi khỏi cột',
            cot.length === 1 && cot[0].tokenHash === sha(tok) && !u1().trustedDevices.includes(tok) && /^tb_/.test(cot[0].id) && cot[0].name === 'Chrome trên Windows', cot.map(d => d.id))
        const han = Date.parse(cot[0].expiresAt) - Date.now()
        dung('hạn thiết bị ≈ 30 ngày', han > 29.9 * 864e5 && han <= 30 * 864e5, han)

        const lanTruoc = cot[0].lastUsed
        await new Promise(r => setTimeout(r, 5))
        const l1 = await dangNhap(A, { deviceToken: tok })
        dung('đăng nhập kèm deviceToken ⇒ cấp phiên ngay, không lần chờ, không email', coPhien(l1) && DB.pending2FA.length === 0 && hopThu.length === 0, l1)
        dung('…và ghi lastUsed', JSON.parse(u1().trustedDevices)[0].lastUsed > lanTruoc, JSON.parse(u1().trustedDevices)[0].lastUsed)
        const l2 = await dangNhap(A, {}, { 'x-device-token': tok })
        dung('header x-device-token cũng được', coPhien(l2), l2)
        const l3 = await dangNhap(A, { deviceToken: crypto.randomBytes(32).toString('hex') })
        dung('token 64 hex lạ ⇒ vẫn hỏi mã app', l3.data?.requireTwoFactor === true && !l3.data?.token, l3)
        const l4 = await dangNhap(A, { deviceId: cot[0].id, deviceToken: cot[0].id })
        dung('gửi id công khai của thiết bị (tb_…) ⇒ KHÔNG vượt (id chỉ để liệt kê / xoá)', l4.data?.requireTwoFactor === true, l4)

        const ds = await goi(A, 'get', '/trusted-devices', { jwt: JWT_U1 })
        dung('GET /trusted-devices: liệt kê thiết bị, KHÔNG có tokenHash',
            ds.ma === 200 && Array.isArray(ds.data) && ds.data.length === 1 && ds.data[0].id === cot[0].id && !('tokenHash' in ds.data[0]) && !JSON.stringify(ds.data).includes(sha(tok)), ds)
        const xoa = await goi(A, 'delete', '/trusted-devices/:id', { jwt: JWT_U1, params: { id: cot[0].id } })
        dung('DELETE /trusted-devices/:id ⇒ bỏ thiết bị', xoa.ma === 200 && Array.isArray(xoa.data) && xoa.data.length === 0 && JSON.parse(u1().trustedDevices).length === 0, xoa)
        const l5 = await dangNhap(A, { deviceToken: tok })
        dung('token của thiết bị đã xoá ⇒ hỏi mã lại', l5.data?.requireTwoFactor === true && !l5.data?.token, l5)
    }
    {
        datLai([nguoiTotp()])
        const { data } = await dangNhap(A)
        const v = await goi(A, 'post', '/verify-2fa', { body: { loginToken: data.loginToken, totpCode: await maApp(), rememberDevice: true } })
        const cot: Hang[] = JSON.parse(u1().trustedDevices)
        cot[0].expiresAt = new Date(Date.now() - 1000).toISOString()
        u1().trustedDevices = JSON.stringify(cot)
        const l = await dangNhap(A, { deviceToken: v.data?.deviceToken })
        dung('token thiết bị quá 30 ngày ⇒ hỏi mã lại', l.data?.requireTwoFactor === true && !l.data?.token, l)
        const ds = await goi(A, 'get', '/trusted-devices', { jwt: JWT_U1 })
        dung('…và không còn trong danh sách', ds.ma === 200 && ds.data.length === 0, ds)
    }
    {
        datLai([nguoiTotp()])
        const ds = await goi(A, 'get', '/trusted-devices', { jwt: JWT_U1 })
        dung("GET /trusted-devices không trả mục kiểu cũ ('android_dev', 'dev_…') — trước đây trả nguyên khoá vượt",
            ds.ma === 200 && ds.data.length === 0 && !JSON.stringify(ds.than).includes('android_dev'), ds)
    }

    // ── 4. Cờ bật, không hạt ⇒ mã email gắn với lần đăng nhập ───────────────
    {
        datLai([nguoiEmail()])
        const r = await dangNhap(A, { deviceId: 'android_dev', deviceToken: 'android_dev' })
        const p = DB.pending2FA[0]
        const ma = maThuCuoi()
        dung('không hạt ⇒ /login gửi MỘT email mã 6 số, trả requiresOtp + loginToken (hình dạng cũ còn đủ: email, storeCode, expiresInMinutes)',
            r.ma === 200 && r.data?.requiresOtp === true && r.data?.method === 'email' && HEX64.test(r.data?.loginToken) && r.data?.email === 'chu@shop.vn'
            && r.data?.storeCode === 'SHOPTHU' && r.data?.expiresInMinutes === 10 && !r.data?.token && hopThu.length === 1 && hopThu[0].to === 'chu@shop.vn' && /^\d{6}$/.test(ma), r)
        dung('CSDL giữ BĂM mã (gắn loginToken), không giữ mã thô; hạn 10 phút',
            p?.method === 'email' && HEX64.test(p?.codeHash) && p.codeHash === sha(`${p.loginToken}:${ma}`) && !Object.values(p).some(v => v === ma)
            && Math.abs(p.expiresAt.getTime() - Date.now() - 10 * 60_000) < 5000, { method: p?.method })
        dung('phản hồi /login không chứa mã email', !JSON.stringify(r.than).includes(ma))
        const loginToken = r.data.loginToken
        const v2fa = await goi(A, 'post', '/verify-2fa', { body: { loginToken, totpCode: ma } })
        dung('lần chờ email KHÔNG dùng được ở verify-2fa ⇒ 400', v2fa.ma === 400 && !v2fa.data?.token, v2fa)
        for (let i = 0; i < 4; i++) {
            const v = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken, code: maKhac(ma) } })
            if (i === 0) dung('verify-otp sai mã ⇒ 400 "còn 4 lần thử"', v.ma === 400 && /còn 4 lần thử/.test(v.than?.error || ''), v)
        }
        const v5 = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken, code: maKhac(ma) } })
        dung('lần sai thứ 5 ⇒ 400 "Quá nhiều lần thử", lần chờ bị xoá', v5.ma === 400 && /Quá nhiều lần thử/.test(v5.than?.error || '') && DB.pending2FA.length === 0, v5)
        const v6 = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken, code: ma } })
        dung('hết lượt rồi thì mã ĐÚNG cũng không qua', v6.ma === 400 && !v6.data?.token, v6)
    }
    {
        datLai([nguoiEmail()])
        const { data } = await dangNhap(A)
        const ma = maThuCuoi()
        const v = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: ma } })
        dung('mã email đúng (kèm loginToken) ⇒ cấp phiên, xoá lần chờ, không deviceToken khi không xin',
            coPhien(v) && DB.pending2FA.length === 0 && v.data?.deviceToken === undefined && v.data?.store?.code === 'SHOPTHU', v)
        const lai = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: ma } })
        dung('dùng lại mã đã qua ⇒ 400', lai.ma === 400 && !lai.data?.token, lai)
    }
    {
        datLai([nguoiEmail()])
        await dangNhap(A)
        const ma = maThuCuoi()
        const v = await goi(A, 'post', '/verify-otp', {
            body: { email: 'CHU@SHOP.VN', storeCode: 'shopthu', code: ma, purpose: 'login_2fa', method: 'email', deviceId: 'android_dev', deviceToken: 'android_dev', trustDevice: true, deviceName: 'Android App' },
        })
        dung('Android 1.0.46 (verify-otp không loginToken, email + mã cửa hàng khác hoa thường) ⇒ vẫn đăng nhập được',
            coPhien(v) && DB.pending2FA.length === 0, v)
        dung('…nhưng không được nhớ thiết bị (app chưa xin rememberDevice), cột thiết bị không đổi', v.data?.deviceToken === undefined && u1().trustedDevices === TB_CU, v.data)
    }
    {
        datLai([nguoiEmail()])
        const l1 = await dangNhap(A)
        const ma1 = maThuCuoi()
        const l2 = await dangNhap(A)
        const ma2 = maThuCuoi()
        const v1 = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: l1.data.loginToken, code: ma1 } })
        dung('đăng nhập lần hai thay lần chờ cũ ⇒ mã + loginToken lần một hết hiệu lực', v1.ma === 400 && !v1.data?.token && DB.pending2FA.length === 1, v1)
        const v2 = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', email: 'chu@shop.vn', storeCode: 'SHOPTHU', code: ma2 } })
        dung('client cũ (không loginToken) khớp lần chờ MỚI NHẤT', coPhien(v2) && l2.data.loginToken !== l1.data.loginToken, v2)
    }
    {
        datLai([nguoiEmail()])
        const { data } = await dangNhap(A)
        const ma1 = maThuCuoi()
        const thu = hopThu.length
        const s0 = await goi(A, 'post', '/send-otp', { body: { email: 'chu@shop.vn', storeCode: 'shopthu', purpose: 'login_2fa' } })
        dung('send-otp login_2fa không loginToken (lỗ cũ, không cần mật khẩu) ⇒ 400, không gửi email', s0.ma === 400 && hopThu.length === thu && /loginToken/.test(s0.than?.error || ''), s0)
        const s1 = await goi(A, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken } })
        dung('gửi lại trong 60 giây ⇒ 429 kèm retryAfter, không gửi', s1.ma === 429 && s1.than?.retryAfter >= 1 && s1.than?.retryAfter <= 60 && hopThu.length === thu, s1)
        await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: maKhac(ma1) } })
        await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: maKhac(ma1) } })
        DB.pending2FA[0].sentAt = new Date(Date.now() - 61_000)
        const s2 = await goi(A, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken } })
        const ma2 = maThuCuoi()
        dung('sau 60 giây: gửi lại ⇒ 200, email mới, lượt thử về 0, hạn mới ≈ 10 phút',
            s2.ma === 200 && hopThu.length === thu + 1 && DB.pending2FA[0]?.attempts === 0 && Math.abs(DB.pending2FA[0].expiresAt.getTime() - Date.now() - 600_000) < 5000, { s2, attempts: DB.pending2FA[0]?.attempts })
        if (ma2 !== ma1) {
            const cu = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: ma1 } })
            dung('mã CŨ hết hiệu lực sau khi gửi lại', cu.ma === 400 && !cu.data?.token, cu)
        }
        const moi = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: ma2 } })
        dung('mã MỚI qua', coPhien(moi), moi)
    }
    {
        datLai([nguoiEmail()])
        const { data } = await dangNhap(A)
        const p = DB.pending2FA[0]
        p.createdAt = new Date(Date.now() - 25 * 60_000)
        p.sentAt = new Date(Date.now() - 61_000)
        const s = await goi(A, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken } })
        const conLai = DB.pending2FA[0]?.expiresAt.getTime() - Date.now()
        dung('gửi lại khi đã qua mật khẩu 25 phút ⇒ hạn mới chỉ tới mốc 30 phút (≈ 5 phút), không 10', s.ma === 200 && conLai > 4.9 * 60_000 && conLai <= 5 * 60_000, { s, conLai })
        DB.pending2FA[0].createdAt = new Date(Date.now() - 31 * 60_000)
        DB.pending2FA[0].sentAt = new Date(Date.now() - 61_000)
        const thu = hopThu.length
        const s2 = await goi(A, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken } })
        dung('quá 30 phút kể từ lúc qua mật khẩu ⇒ 400 đăng nhập lại, xoá lần chờ, không gửi', s2.ma === 400 && DB.pending2FA.length === 0 && hopThu.length === thu, s2)
    }
    {
        datLai([nguoiEmail()])
        emailHong = true
        const r = await dangNhap(A)
        emailHong = false
        dung('SMTP hỏng lúc /login ⇒ 500, KHÔNG để lại lần chờ', r.ma === 500 && DB.pending2FA.length === 0 && !r.data?.token, r)
        const { data } = await dangNhap(A)
        DB.pending2FA[0].sentAt = new Date(Date.now() - 61_000)
        emailHong = true
        const s = await goi(A, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken } })
        emailHong = false
        const s2 = await goi(A, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken } })
        dung('SMTP hỏng lúc gửi lại ⇒ 500, rồi gửi lại NGAY được (không bị giãn cách 60 giây)', s.ma === 500 && s2.ma === 200, { s, s2 })
        const v = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: maThuCuoi() } })
        dung('…và mã của lần gửi lại qua', coPhien(v), v)
    }
    {
        datLai([nguoiEmail()])
        const { data } = await dangNhap(A)
        const maDau = maThuCuoi()
        const sai = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: maDau === '000000' ? '111111' : '000000' } })
        DB.pending2FA[0].sentAt = new Date(Date.now() - 61_000)
        emailHong = true
        const s = await goi(A, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken } })
        emailHong = false
        const p = DB.pending2FA[0]
        dung('SMTP hỏng lúc gửi lại ⇒ dòng chờ trả về như trước (vẫn tính lần thử sai đã có, không reset về 0)', sai.ma === 400 && s.ma === 500 && p?.attempts === 1, { sai, s, attempts: p?.attempts })
        const v = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: maDau } })
        dung('…và mã trong thư lúc đăng nhập VẪN dùng được (không bị mã chưa gửi tới ai đè mất)', coPhien(v), v)
    }
    {
        datLai([nguoiEmail()])
        process.env.NODE_ENV = 'production'
        delete process.env.SMTP_USER
        const r = await dangNhap(A)
        dung('PROD thiếu SMTP + người dùng 2FA email ⇒ 503, không lần chờ, không "gửi" (không in mã vào log)', r.ma === 503 && DB.pending2FA.length === 0 && hopThu.length === 0 && !r.data?.token, r)
        datLai([nguoiTotp()])
        const r2 = await dangNhap(A)
        dung('PROD thiếu SMTP + người dùng TOTP ⇒ vẫn hỏi mã app như thường', r2.data?.requireTwoFactor === true, r2)
        process.env.NODE_ENV = 'test'
    }
    {
        datLai([nguoiEmail()])
        const { data } = await dangNhap(A)
        const v = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: maThuCuoi(), rememberDevice: true, deviceName: 'iPhone' } })
        dung('verify-otp + rememberDevice ⇒ trả deviceToken', coPhien(v) && HEX64.test(v.data?.deviceToken), v)
        const thu = hopThu.length
        const l = await dangNhap(A, { deviceToken: v.data?.deviceToken })
        dung('đăng nhập kèm deviceToken ⇒ phiên ngay, KHÔNG gửi email', coPhien(l) && hopThu.length === thu && DB.pending2FA.length === 0, l)
    }
    {
        datLai([nguoiEmail()])
        const { data } = await dangNhap(A)
        u1().isLocked = true
        const v = await goi(A, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: maThuCuoi() } })
        dung('bị khoá giữa chừng ⇒ verify-otp 403, không phiên', v.ma === 403 && !v.data?.token, v)
    }

    // ── 5. Bật 2FA qua email ─────────────────────────────────────────────────
    {
        datLai([nguoi()])
        const s = await goi(A, 'post', '/setup-2fa', { jwt: JWT_U1, body: { method: 'email' } })
        const ma = maThuCuoi()
        dung('setup-2fa method email ⇒ 200, gửi MỘT email "bật xác thực", chưa đổi gì ở User',
            s.ma === 200 && s.data?.method === 'email' && hopThu.length === 1 && /bật xác thực/i.test(hopThu[0].subject) && u1().twoFactorEnabled === false && u1().twoFactorSecret === null
            && DB.pending2FA.length === 1 && DB.pending2FA[0].method === 'bat_email', s)
        const s2 = await goi(A, 'post', '/setup-2fa', { jwt: JWT_U1, body: { method: 'email' } })
        dung('bấm gửi lại trong 60 giây ⇒ 429, không gửi', s2.ma === 429 && hopThu.length === 1, s2)
        const c1 = await goi(A, 'post', '/confirm-2fa', { jwt: JWT_U1, body: { method: 'email', code: maKhac(ma) } })
        dung('confirm-2fa email sai mã ⇒ 400 "còn 4 lần thử", cờ vẫn tắt', c1.ma === 400 && /còn 4 lần thử/.test(c1.than?.error || '') && u1().twoFactorEnabled === false, c1)
        const c2 = await goi(A, 'post', '/confirm-2fa', { jwt: JWT_U1, body: { method: 'email', code: ma } })
        dung('confirm-2fa email đúng mã ⇒ bật 2FA KHÔNG hạt, xoá lần chờ',
            c2.ma === 200 && c2.data?.twoFactorMethod === 'email' && u1().twoFactorEnabled === true && u1().twoFactorSecret === null && DB.pending2FA.length === 0, c2)
        const me = await goi(A, 'get', '/me', { jwt: JWT_U1 })
        dung('/me trả twoFactorMethod "email", không có hạt', me.ma === 200 && me.data?.twoFactorMethod === 'email' && me.data?.twoFactorEnabled === true && !('twoFactorSecret' in (me.data || {})), me)
        hopThu.length = 0
        const l = await dangNhap(A)
        dung('từ đó /login hỏi mã email', l.data?.requiresOtp === true && hopThu.length === 1, l)
        const s3 = await goi(A, 'post', '/setup-2fa', { jwt: JWT_U1, body: { method: 'email' } })
        dung('đã bật rồi ⇒ setup-2fa email 400', s3.ma === 400, s3)
    }
    {
        datLai([nguoi()])
        const s = await goi(A, 'post', '/setup-2fa', { jwt: { ...JWT_U1, apiKeyScopes: 'admin' }, body: { method: 'email' } })
        dung('token đổi từ khoá API admin ⇒ setup-2fa email 403, không gửi, không lần chờ', s.ma === 403 && hopThu.length === 0 && DB.pending2FA.length === 0, s)
        const c = await goi(A, 'post', '/confirm-2fa', { jwt: JWT_U1, body: { method: 'email', code: '123456' } })
        dung('confirm-2fa email khi chưa gửi mã ⇒ 400, cờ vẫn tắt', c.ma === 400 && u1().twoFactorEnabled === false, c)
        const s2 = await goi(A, 'post', '/setup-2fa', { jwt: JWT_U1, body: { method: 'sms' } })
        dung("method lạ ('sms') ⇒ 400", s2.ma === 400, s2)
    }
    {
        datLai([nguoi()])
        await goi(A, 'post', '/setup-2fa', { jwt: JWT_U1, body: { method: 'email' } })
        DB.pending2FA[0].expiresAt = new Date(Date.now() - 1000)
        const c = await goi(A, 'post', '/confirm-2fa', { jwt: JWT_U1, body: { method: 'email', code: maThuCuoi() } })
        dung('mã bật 2FA quá 10 phút ⇒ 400, cờ vẫn tắt', c.ma === 400 && u1().twoFactorEnabled === false, c)
    }
    {
        const HAT_BO_DO = otplib.generateSecret()
        BI_MAT.push(HAT_BO_DO)
        datLai([nguoi({ twoFactorSecret: HAT_BO_DO })]) // từng bấm "Thiết Lập 2FA" bằng app rồi bỏ ngang
        await goi(A, 'post', '/setup-2fa', { jwt: JWT_U1, body: { method: 'email' } })
        const c = await goi(A, 'post', '/confirm-2fa', { jwt: JWT_U1, body: { method: 'email', code: maThuCuoi() } })
        dung('bật qua email xoá hạt TOTP dở dang', c.ma === 200 && u1().twoFactorEnabled === true && u1().twoFactorSecret === null, c)
        const l = await dangNhap(A)
        dung('…nên /login hỏi mã email, không hỏi mã app theo hạt chưa ai xác nhận', l.data?.requiresOtp === true && !l.data?.requireTwoFactor, l)
    }

    // ── 6. Bật bằng app (TOTP) như cũ + /me ──────────────────────────────────
    {
        datLai([nguoi()])
        const me0 = await goi(A, 'get', '/me', { jwt: JWT_U1 })
        dung('/me khi chưa bật ⇒ twoFactorMethod null', me0.ma === 200 && me0.data?.twoFactorMethod === null, me0)
        // setup-2fa trả hạt cho CHÍNH CHỦ quét QR — có chủ ý, nên chỉ thêm hạt vào danh sách soi lộ SAU lời gọi này
        const s = await goi(A, 'post', '/setup-2fa', { jwt: JWT_U1 })
        const hat = s.data?.secret
        dung('setup-2fa không body (TOTP, hình dạng cũ) ⇒ hạt + otpauthUrl, không gửi email', s.ma === 200 && typeof hat === 'string' && /^otpauth:/.test(s.data?.otpauthUrl) && hopThu.length === 0, s.ma)
        if (hat) BI_MAT.push(hat)
        const c = await goi(A, 'post', '/confirm-2fa', { jwt: JWT_U1, body: { totpCode: String(await otplib.generate({ secret: hat })) } })
        dung('confirm-2fa TOTP đúng mã ⇒ bật, data.twoFactorMethod "totp"', c.ma === 200 && c.data?.twoFactorMethod === 'totp' && u1().twoFactorEnabled === true && u1().twoFactorSecret === hat, c)
        const me = await goi(A, 'get', '/me', { jwt: JWT_U1 })
        dung('/me trả twoFactorMethod "totp", KHÔNG trả hạt', me.ma === 200 && me.data?.twoFactorMethod === 'totp' && !('twoFactorSecret' in (me.data || {})), me)
        const l = await dangNhap(A)
        dung('từ đó /login chỉ hỏi mã app, không gửi email', l.data?.requireTwoFactor === true && hopThu.length === 0, l)
        const cSai = await goi(A, 'post', '/confirm-2fa', { jwt: JWT_U1, body: { totpCode: 'abc' } })
        dung('confirm-2fa mã app sai định dạng ⇒ 400 (trước đây 500)', cSai.ma === 400, cSai)
    }

    // ── 7. Cửa hàng demo + quên mật khẩu không đổi ───────────────────────────
    {
        datLai([], [nguoiTotp()])
        const r = await goi(A, 'post', '/login', { body: { email: 'chu@shop.vn', password: MAT_KHAU, storeCode: 'kengionline' } })
        dung('KENGIONLINE (demo) bỏ qua 2FA như cũ', coPhien(r) && DB.pending2FA.length === 0, r)
    }
    {
        datLai([nguoiEmail()])
        const s = await goi(A, 'post', '/send-otp', { body: { purpose: 'password_reset', email: 'chu@shop.vn', storeCode: 'shopthu' } })
        const v = await goi(A, 'post', '/verify-otp', { body: { purpose: 'password_reset', email: 'chu@shop.vn', storeCode: 'shopthu', code: maThuCuoi() } })
        dung('quên mật khẩu (send-otp / verify-otp password_reset) chạy như cũ', s.ma === 200 && hopThu.length === 1 && v.ma === 200 && typeof v.data?.resetToken === 'string', { s, v })
        const s2 = await goi(A, 'post', '/send-otp', { body: { purpose: 'password_reset', email: 'khongco@shop.vn', storeCode: 'khongco' } })
        dung('quên mật khẩu: cửa hàng / email không có ⇒ vẫn 200 im lặng (không lộ email nào tồn tại)', s2.ma === 200 && hopThu.length === 1, s2)
    }

    // ── 8. Nhiều bản Cloud Run: đăng nhập ở bản A, nhập mã ở bản B ────────────
    {
        const B = napRouter()
        dung('nạp được bản B (module mới, RAM mới) trên cùng CSDL giả', B !== A && cacBuoc(B, 'post', '/verify-otp').length === 1)
        datLai([nguoiEmail()])
        const { data } = await dangNhap(A)
        const v = await goi(B, 'post', '/verify-otp', { body: { purpose: 'login_2fa', loginToken: data.loginToken, code: maThuCuoi() } })
        dung('mã email: đăng nhập ở bản A, nhập mã ở bản B ⇒ qua (trước đây mã nằm trong RAM bản A)', coPhien(v), v)
        const l2 = await dangNhap(A)
        const s = await goi(B, 'post', '/send-otp', { body: { purpose: 'login_2fa', loginToken: l2.data.loginToken } })
        dung('giãn cách gửi lại 60 giây áp cả khi bấm gửi lại rơi vào bản B', s.ma === 429, s)

        datLai([nguoiTotp()])
        const l = await dangNhap(A)
        for (let i = 0; i < 4; i++) await goi(i % 2 ? A : B, 'post', '/verify-2fa', { body: { loginToken: l.data.loginToken, totpCode: maKhac(await maApp()) } })
        const v5 = await goi(B, 'post', '/verify-2fa', { body: { loginToken: l.data.loginToken, totpCode: maKhac(await maApp()) } })
        dung('sai mã app rải qua hai bản ⇒ vẫn chỉ 5 lượt tổng (lần 5 ⇒ 429)', v5.ma === 429 && DB.pending2FA.length === 0, v5)
    }

    dung('không phản hồi nào chứa hạt TOTP / hash mật khẩu / băm mã / băm token thiết bị', lo.length === 0, lo.slice(0, 5))
    dung('không truy vấn lạ nào tới prisma giả', goiLa.length === 0, goiLa.slice(0, 8))
}

;(async () => {
    try {
        await chay()
    } catch (e: any) {
        loi++
        console.error('✗ bộ soát lỗi:', e?.stack || e)
    } finally {
        process.env.NODE_ENV = NODE_ENV_GOC
        if (SMTP_GOC !== undefined) process.env.SMTP_USER = SMTP_GOC
    }
    console.log(loi ? `\n✗ ${loi}/${soCa} ca SAI` : `\n✓ ${soCa}/${soCa} ca đạt`)
    process.exit(loi ? 1 : 0)
})()
