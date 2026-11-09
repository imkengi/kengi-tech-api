/**
 * Bộ soát ĐỔI EMAIL ĐĂNG NHẬP — npx tsx scripts/check-doi-email.ts
 *
 * Vì sao (09/11/2026): `PUT /api/auth/update-email` (Cài đặt → Bảo Mật Tài Khoản → "Email tài khoản") ghi thẳng `newEmail`:
 * không hỏi mật khẩu, không kiểm định dạng, không kiểm trùng. Email là chìa khoá tài khoản — "Quên mật khẩu" gửi OTP về email,
 * đăng nhập Google lấy danh tính từ email trong token Google (không so mật khẩu), cổng OTP 2FA ở /login gửi mã về email ⇒ ai cầm
 * phiên đăng nhập, hay token đổi từ khoá API write/admin, đổi email chủ tài khoản sang hộp thư của mình là chiếm hẳn tài khoản,
 * vượt cả 2FA, và sống tiếp sau khi thu hồi khoá. Bộ soát canh:
 *
 *   1. Hàm thuần `lyDoChanDoiThongTinDangNhap` / `diBangKhoaApi` (lib/phamViKhoaApi.ts): đi bằng khoá (cờ viaApiKey hoặc claim
 *      apiKeyScopes) ⇒ chặn; đăng nhập thường ⇒ cho qua.
 *   2. Chạy THẬT authMiddleware + handler của PUT /update-email: JWT ký bằng khoá thử (không claim schema ⇒ giữ storePrisma giả),
 *      bảng User trong bộ nhớ trả đúng theo `select`, điều kiện `where` lạ / truy vấn ngoài user.findUnique · findFirst · update
 *      là lỗi (prisma giả mà lờ điều kiện thì ca "không trùng" đạt oan). Không DB, không mạng.
 *      Ca: thiếu / rỗng / sai kiểu / sai mật khẩu ⇒ từ chối, KHÔNG ghi; đúng ⇒ đổi (cắt khoảng trắng, hạ chữ thường); sai dạng
 *      email ⇒ 400; trùng người khác (không phân biệt hoa thường) ⇒ 409; hai người giành cùng email (P2002) ⇒ 409; khoá API
 *      (JWT đổi từ khoá admin / read,write / read, X-API-Key) ⇒ 403 kể cả kèm đúng mật khẩu, không một truy vấn nào.
 *   3. Sau mỗi ca bị từ chối, tra email kẻ gian như send-otp / đăng nhập Google tra (findFirst theo email) KHÔNG ra chủ tài khoản.
 *
 * Thử ngược: chạy bộ soát trên routes/auth.ts trước bản vá (origin/master 5f58ed6) phải đỏ.
 */
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { lyDoChanDoiThongTinDangNhap, diBangKhoaApi, lyDoChanDucPhien } from '../src/lib/phamViKhoaApi'

let soCa = 0
let loi = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    soCa++
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}

// ─── 1. Hàm thuần ────────────────────────────────────────────────────────────
function soatHamThuan() {
    const GOI_Y = 'gợi ý thử'
    dung('đổi thông tin đăng nhập: cờ viaApiKey (X-API-Key / JWT đổi từ khoá) ⇒ chặn, kèm gợi ý',
        [true, 1, 'x'].every(c => String(lyDoChanDoiThongTinDangNhap(c, { userId: 'u' }, GOI_Y)).endsWith(GOI_Y)))
    dung('đổi thông tin đăng nhập: claim apiKeyScopes (admin / * / read,write / rỗng / null / thiếu giá trị) ⇒ chặn dù thiếu cờ',
        ['admin', 'read,write', '*', 'read', '', null, undefined].every(s => !!lyDoChanDoiThongTinDangNhap(undefined, { userId: 'u', apiKeyScopes: s }, GOI_Y)))
    dung('đổi thông tin đăng nhập: đăng nhập thường (không cờ, không claim) ⇒ cho qua',
        [undefined, false, 0, ''].every(c => lyDoChanDoiThongTinDangNhap(c, { userId: 'u', role: 'admin', storeCode: 'HUTI' }, GOI_Y) === null)
        && [undefined, null, 'chuoi', 42].every(p => lyDoChanDoiThongTinDangNhap(undefined, p, GOI_Y) === null))
    dung('đổi thông tin đăng nhập: lý do nói rõ bằng tiếng Việt, nói đúng việc (không phải câu "đúc phiên")',
        /^Khoá API không đổi được thông tin đăng nhập/.test(String(lyDoChanDoiThongTinDangNhap(true, {}, GOI_Y))))
    // diBangKhoaApi là lõi chung với lyDoChanDucPhien (switch-branch / livestream) — hai luật phải nhận diện khoá Y HỆT nhau
    const luoiCo: unknown[] = [undefined, null, false, true, 0, 1, '', 'x']
    const luoiPayload: unknown[] = [undefined, null, 'chuoi', 42, {}, { userId: 'u' }, { apiKeyScopes: 'admin' }, { apiKeyScopes: undefined }, { apiKeyScopes: '' }]
    const lech: string[] = []
    for (const c of luoiCo) for (const p of luoiPayload) {
        const k = diBangKhoaApi(c, p)
        if (k !== !!lyDoChanDoiThongTinDangNhap(c, p, GOI_Y) || k !== !!lyDoChanDucPhien(c, p, GOI_Y)) lech.push(`${JSON.stringify(c)} × ${JSON.stringify(p)}`)
    }
    dung(`diBangKhoaApi ≡ lyDoChanDoiThongTinDangNhap ≡ lyDoChanDucPhien (${luoiCo.length * luoiPayload.length} tổ hợp cờ × payload)`, lech.length === 0, lech.slice(0, 5))
}

// ─── 2. Chạy thật PUT /update-email ──────────────────────────────────────────
type HangUser = { id: string; email: string; password: string; name: string; twoFactorEnabled: boolean }

/** Bảng User trong bộ nhớ. Hiểu ĐÚNG các dạng where mà tuyến dùng; dạng lạ ⇒ ném lỗi (không lờ điều kiện). */
function taoKho(hang: HangUser[], tuyChon: { sauFindFirst?: (bang: Map<string, HangUser>) => void } = {}) {
    const bang = new Map(hang.map(h => [h.id, { ...h }]))
    const goi: string[] = []
    const chon = (r: any, select?: Record<string, boolean>) =>
        select ? Object.fromEntries(Object.entries(select).filter(([, v]) => v).map(([k]) => [k, r[k]])) : { ...r }
    const khopEmail = (gt: string, dk: unknown): boolean => {
        if (typeof dk === 'string') return gt === dk
        if (dk && typeof dk === 'object') {
            const { equals, mode, ...con } = dk as Record<string, unknown>
            if (Object.keys(con).length || typeof equals !== 'string' || (mode !== undefined && mode !== 'insensitive' && mode !== 'default'))
                throw new Error(`prisma giả: điều kiện email lạ ${JSON.stringify(dk)}`)
            return mode === 'insensitive' ? gt.toLowerCase() === equals.toLowerCase() : gt === equals
        }
        throw new Error(`prisma giả: điều kiện email lạ ${JSON.stringify(dk)}`)
    }
    const khop = (r: HangUser, where: any): boolean => {
        for (const [k, v] of Object.entries(where || {})) {
            if (k === 'id') { if (r.id !== v) return false }
            else if (k === 'email') { if (!khopEmail(r.email, v)) return false }
            else if (k === 'NOT') {
                const ds = Array.isArray(v) ? v : [v]
                if (ds.some(d => khop(r, d))) return false
            } else throw new Error(`prisma giả: điều kiện lạ "${k}"`)
        }
        return true
    }
    const lam = {
        findUnique: async ({ where, select }: any) => {
            goi.push('user.findUnique')
            if (!where || Object.keys(where).join() !== 'id') throw new Error(`prisma giả: findUnique chỉ theo id, nhận ${JSON.stringify(where)}`)
            const r = bang.get(where.id)
            return r ? chon(r, select) : null
        },
        findFirst: async ({ where, select }: any) => {
            goi.push('user.findFirst')
            const r = [...bang.values()].find(h => khop(h, where))
            tuyChon.sauFindFirst?.(bang)
            return r ? chon(r, select) : null
        },
        update: async ({ where, data, select }: any) => {
            goi.push('user.update')
            const r = bang.get(where?.id)
            if (!r) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' })
            // Postgres: "User".email @unique — so NGUYÊN VĂN (phân biệt hoa thường) như chỉ mục thật
            if (typeof data?.email === 'string' && [...bang.values()].some(h => h.id !== r.id && h.email === data.email))
                throw Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), { code: 'P2002' })
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
    /** Như send-otp / verify-otp / đăng nhập Google: tra người dùng theo email đúng nguyên văn. */
    const traTheoEmail = (email: string) => [...bang.values()].find(h => h.email === email.trim().toLowerCase()) || null
    return { prisma, bang, goi, hang: (id = 'u1') => bang.get(id)!, traTheoEmail }
}

const cacBuoc = (router: any, method: string, duong: string): Function[] =>
    router.stack.find((l: any) => l.route?.path === duong && l.route.methods[method])?.route.stack.map((l: any) => l.handle) || []
const resGia = () => ({ ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } })

async function chayTuyen() {
    process.env.JWT_SECRET = 'khoa-thu-check-doi-email'
    process.env.DATABASE_URL = 'postgresql://khong-dung-db@127.0.0.1:9/khong'   // phòng hờ: bộ soát không bao giờ chạm CSDL thật
    const { authMiddleware } = await import('../src/middleware/auth')
    const { default: authRouter } = await import('../src/routes/auth')

    const buoc = cacBuoc(authRouter, 'put', '/update-email')
    dung('tìm được PUT /update-email trong router: authMiddleware + handler', buoc.length === 2 && buoc[0] === authMiddleware, buoc.length)

    const MAT_KHAU = 'MatKhau@123'
    const HASH = await bcrypt.hash(MAT_KHAU, 4)
    const EMAIL_CHU = 'chu@shop.vn'
    const KE_GIAN = 'ke.gian@gmail.com'
    const chu = (ghiDe: Partial<HangUser> = {}): HangUser =>
        ({ id: 'u1', email: EMAIL_CHU, password: HASH, name: 'Chủ shop', twoFactorEnabled: true, ...ghiDe })
    const nhanVien = (id: string, email: string): HangUser => ({ id, email, password: HASH, name: 'NV', twoFactorEnabled: false })

    /** Gọi tuyến qua ĐỦ các bước. claim: thêm vào JWT (vd apiKeyScopes); null = đi X-API-Key (gắn sẵn đúng thứ tryApiKeyAuth gắn). */
    const goi = async (kho: ReturnType<typeof taoKho>, body: any, claim: Record<string, unknown> | null = {}) => {
        const req: any = { headers: {}, method: 'PUT', originalUrl: '/api/auth/update-email', body, storePrisma: kho.prisma }
        let cacB = buoc
        if (claim) {
            const tok = jwt.sign({ userId: 'u1', email: EMAIL_CHU, role: 'admin', ...claim }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' })
            req.headers.authorization = `Bearer ${tok}`
        } else {
            // khớp X-API-Key cần CSDL ⇒ gắn sẵn req.user (KHÔNG claim) + cờ viaApiKey như tryApiKeyAuth, chạy từ handler
            Object.assign(req, { user: { userId: 'u1', email: EMAIL_CHU, role: 'admin' }, viaApiKey: true, apiKeyScopes: 'admin' })
            cacB = buoc.slice(1)
        }
        const res = resGia()
        for (const b of cacB) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
        return { ma: res.ma, than: res.than }
    }
    const khongGhi = (kho: ReturnType<typeof taoKho>) => !kho.goi.includes('user.update')
    const chuNguyenVen = (kho: ReturnType<typeof taoKho>) => kho.hang().email === EMAIL_CHU && kho.traTheoEmail(KE_GIAN) === null
    const khongLoBiMat = (than: unknown) => { const s = JSON.stringify(than ?? null); return !s.includes(HASH) && !s.includes(MAT_KHAU) }

    // ── Thiếu / sai mật khẩu ⇒ từ chối, không ghi, email kẻ gian không dẫn tới chủ tài khoản
    for (const [ten, body, cau] of [
        ['không mật khẩu (web bản cũ)', { newEmail: KE_GIAN }, 'Mật khẩu là bắt buộc'],
        ['mật khẩu rỗng', { newEmail: KE_GIAN, password: '' }, 'Mật khẩu là bắt buộc'],
        ['mật khẩu không phải chuỗi (số)', { newEmail: KE_GIAN, password: 123456 }, 'Mật khẩu là bắt buộc'],
        ['mật khẩu là mảng', { newEmail: KE_GIAN, password: [MAT_KHAU] }, 'Mật khẩu là bắt buộc'],
        ['sai mật khẩu', { newEmail: KE_GIAN, password: 'Sai@1234' }, 'Mật khẩu không đúng'],
    ] as Array<[string, any, string]>) {
        const kho = taoKho([chu()])
        const r = await goi(kho, body)
        dung(`${ten} ⇒ 400 "${cau}", không ghi, tra "${KE_GIAN}" (Quên mật khẩu / Google) không ra chủ tài khoản`,
            r.ma === 400 && r.than?.success === false && r.than?.error === cau && khongGhi(kho) && chuNguyenVen(kho) && khongLoBiMat(r.than), { r, goi: kho.goi })
    }

    // ── Đúng mật khẩu ⇒ đổi
    {
        const kho = taoKho([chu()])
        const r = await goi(kho, { newEmail: '  Moi.Chu@Shop.VN ', password: MAT_KHAU })
        dung('đúng mật khẩu ⇒ 200 "Cập nhật email thành công", email mới cắt khoảng trắng + hạ chữ thường, trả data.email',
            r.ma === 200 && r.than?.success === true && r.than?.message === 'Cập nhật email thành công'
            && r.than?.data?.email === 'moi.chu@shop.vn' && kho.hang().email === 'moi.chu@shop.vn', { r, email: kho.hang().email })
        dung('đúng mật khẩu ⇒ chỉ đụng user.findUnique → findFirst (kiểm trùng) → update; mật khẩu / hash không lọt ra response',
            kho.goi.join(',') === 'user.findUnique,user.findFirst,user.update' && khongLoBiMat(r.than), kho.goi)
        dung('đúng mật khẩu ⇒ chỉ đổi email, cờ 2FA + mật khẩu giữ nguyên', kho.hang().twoFactorEnabled === true && kho.hang().password === HASH)
    }
    {
        const kho = taoKho([chu()])
        const r = await goi(kho, { newEmail: 'Chu@Shop.vn', password: MAT_KHAU })
        dung('email mới = email hiện tại (khác hoa thường lúc gõ) ⇒ 200 "Email không đổi", không ghi',
            r.ma === 200 && r.than?.message === 'Email không đổi' && r.than?.data?.email === EMAIL_CHU && khongGhi(kho), { r, goi: kho.goi })
    }
    {
        // email cũ lưu chữ HOA (PUT /employees/:id không hạ chữ thường) ⇒ /login tra bản chữ thường không thấy; lưu lại là chữa
        const kho = taoKho([chu({ email: 'Chu@Shop.VN' })])
        const r = await goi(kho, { newEmail: 'chu@shop.vn', password: MAT_KHAU })
        dung('email cũ lưu chữ hoa, gõ lại bản chữ thường ⇒ 200, lưu "chu@shop.vn" (không bị coi là trùng chính mình)',
            r.ma === 200 && kho.hang().email === 'chu@shop.vn', { r, email: kho.hang().email })
    }

    // ── Định dạng
    for (const [ten, newEmail, cau] of [
        ['không có newEmail', undefined, 'Email mới là bắt buộc'],
        ['newEmail toàn khoảng trắng', '   ', 'Email mới là bắt buộc'],
        ['newEmail là mảng', [KE_GIAN], 'Email mới là bắt buộc'],
        ['thiếu @', 'ke.gian.gmail.com', 'Email không hợp lệ'],
        ['thiếu tên miền cấp cao', 'ke@gian', 'Email không hợp lệ'],
        ['có khoảng trắng giữa', 'ke gian@gmail.com', 'Email không hợp lệ'],
        ['hai dấu @', 'ke@@gmail.com', 'Email không hợp lệ'],
        ['dài quá 254 ký tự', 'k'.repeat(250) + '@g.vn', 'Email không hợp lệ'],
    ] as Array<[string, any, string]>) {
        const kho = taoKho([chu()])
        const r = await goi(kho, { newEmail, password: MAT_KHAU })
        dung(`${ten} ⇒ 400 "${cau}", không truy vấn, không ghi`, r.ma === 400 && r.than?.error === cau && kho.goi.length === 0 && chuNguyenVen(kho), { r, goi: kho.goi })
    }
    {
        const kho = taoKho([chu()])
        const r = await goi(kho, undefined)
        dung('không body ⇒ 400 "Email mới là bắt buộc", không truy vấn', r.ma === 400 && r.than?.error === 'Email mới là bắt buộc' && kho.goi.length === 0, r)
    }

    // ── Trùng email người khác trong cửa hàng
    {
        const kho = taoKho([chu(), nhanVien('u2', 'nv@shop.vn')])
        const r = await goi(kho, { newEmail: 'NV@shop.vn', password: MAT_KHAU })
        dung('trùng email nhân viên khác ⇒ 409, không ghi, email hai người giữ nguyên',
            r.ma === 409 && r.than?.error === 'Email này đã có tài khoản khác trong cửa hàng' && khongGhi(kho)
            && kho.hang().email === EMAIL_CHU && kho.hang('u2').email === 'nv@shop.vn', { r, goi: kho.goi })
    }
    {
        // chỉ mục unique của Postgres phân biệt hoa thường ⇒ chỉ kiểm nguyên văn thì lọt; hai tài khoản cùng email khác hoa thường
        const kho = taoKho([chu(), nhanVien('u2', 'Nv2@Shop.VN')])
        const r = await goi(kho, { newEmail: 'nv2@shop.vn', password: MAT_KHAU })
        dung('trùng email người khác lưu CHỮ HOA ("Nv2@Shop.VN") ⇒ vẫn 409 (so không phân biệt hoa thường), không ghi',
            r.ma === 409 && khongGhi(kho) && kho.hang().email === EMAIL_CHU, { r, goi: kho.goi })
    }
    {
        const kho = taoKho([chu(), nhanVien('u2', 'nv@shop.vn')])
        const r = await goi(kho, { newEmail: 'nv@shop.vn', password: 'Sai@1234' })
        dung('trùng email + SAI mật khẩu ⇒ 400 "Mật khẩu không đúng" (không lộ email nào đã có tài khoản), không kiểm trùng',
            r.ma === 400 && r.than?.error === 'Mật khẩu không đúng' && !kho.goi.includes('user.findFirst') && khongGhi(kho), { r, goi: kho.goi })
    }
    {
        // hai người cùng giành: kiểm trùng xong thì người kia vừa lấy email ⇒ chỉ mục unique ném P2002
        const kho = taoKho([chu()], { sauFindFirst: b => b.set('u3', nhanVien('u3', 'tranh@shop.vn')) })
        const r = await goi(kho, { newEmail: 'tranh@shop.vn', password: MAT_KHAU })
        dung('giành email cùng lúc (P2002 từ chỉ mục unique) ⇒ 409, không 500', r.ma === 409 && r.than?.error === 'Email này đã có tài khoản khác trong cửa hàng' && kho.hang().email === EMAIL_CHU, r)
    }
    {
        const kho = taoKho([])
        const r = await goi(kho, { newEmail: 'moi@shop.vn', password: MAT_KHAU })
        dung('không thấy người dùng ⇒ 404', r.ma === 404, r)
    }

    // ── Khoá API ⇒ 403 kể cả kèm ĐÚNG mật khẩu, không một truy vấn nào
    for (const [ten, claim, mau] of [
        ['JWT đổi từ khoá admin ("API Secret")', { apiKeyScopes: 'admin' }, /không đổi được thông tin đăng nhập/],
        ['JWT đổi từ khoá read,write', { apiKeyScopes: 'read,write' }, /không đổi được thông tin đăng nhập/],
        ['JWT đổi từ khoá *', { apiKeyScopes: '*' }, /không đổi được thông tin đăng nhập/],
        ['JWT đổi từ khoá read (authMiddleware chặn trước: luật ghi)', { apiKeyScopes: 'read' }, /chỉ có quyền đọc/],
        ['X-API-Key khoá admin (chỉ cờ viaApiKey, không claim)', null, /không đổi được thông tin đăng nhập/],
    ] as Array<[string, Record<string, unknown> | null, RegExp]>) {
        const kho = taoKho([chu()])
        const r = await goi(kho, { newEmail: KE_GIAN, password: MAT_KHAU }, claim)
        dung(`${ten} + đúng mật khẩu ⇒ 403, không truy vấn, email chủ giữ nguyên`,
            r.ma === 403 && mau.test(String(r.than?.error)) && kho.goi.length === 0 && chuNguyenVen(kho), { r, goi: kho.goi })
    }
    {
        const kho = taoKho([chu()])
        const r = await goi(kho, { newEmail: 'moi@shop.vn', password: MAT_KHAU }, {})
        dung('JWT đăng nhập thường (không claim) + đúng mật khẩu ⇒ qua lớp chặn khoá, đổi được', r.ma === 200 && kho.hang().email === 'moi@shop.vn', r)
    }
    {
        const kho = taoKho([chu()])
        const req: any = { headers: { authorization: `Bearer ${jwt.sign({ userId: 'u1', role: 'admin' }, 'khoa-gia-mao', { algorithm: 'HS256' })}` },
            method: 'PUT', originalUrl: '/api/auth/update-email', body: { newEmail: KE_GIAN, password: MAT_KHAU }, storePrisma: kho.prisma }
        const res = resGia()
        let tiep = false
        await buoc[0](req, res, () => { tiep = true })
        dung('JWT ký sai khoá ⇒ authMiddleware 401, không tới handler', !tiep && res.ma === 401 && chuNguyenVen(kho), { ma: res.ma })
    }
}

;(async () => {
    soatHamThuan()
    await chayTuyen()
    console.log(loi ? `\n✗ ${loi}/${soCa} ca SAI` : `\n✓ ${soCa}/${soCa} ca đạt`)
    process.exit(loi ? 1 : 0)
})().catch(e => { console.error('✗ bộ soát lỗi:', e); process.exit(1) })
