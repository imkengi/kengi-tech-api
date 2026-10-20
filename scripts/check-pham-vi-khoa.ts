/**
 * Bộ soát PHẠM VI API KEY ĐI THEO JWT (lib/phamViKhoaApi.ts + middleware/auth.ts + /auth/token + livestream) — 20/10/2026.
 *   npx tsx scripts/check-pham-vi-khoa.ts
 * Sự cố: POST /api/auth/token đổi khoá thành JWT 1 giờ mà JWT KHÔNG mang scope ⇒ khoá 'read' đổi token là có JWT toàn quyền
 * người tạo khoá (ghi / sửa / xoá được hết; nhánh X-API-Key thì chặn). Nay JWT mang claim apiKeyScopes và mọi chỗ nhận JWT
 * áp CÙNG một luật với nhánh X-API-Key. Không DB: authMiddleware chạy thật với JWT ký bằng khoá thử (không storeId ⇒ không
 * tra registry), còn /auth/token + livestream soát bằng đọc nguồn.
 * Kèm: khoá 'chatbot' POST /api/chatbot/webhook phải QUA luật ghi — webhook thêm cùng ngày, luật ghi cũ chặn nó 403
 * (bộ soát chatbot chỉ thử phạm vi đường nên không thấy).
 * Cùng ngày, lỗ thứ hai: khoá write/admin gọi POST /auth/switch-branch ⇒ createTokenPair đúc refresh token 90 ngày KHÔNG mang
 * scope, sống tiếp sau khi thu hồi khoá (livestream /session-token tương tự: studio token 12h từ token khoá 1h). Nay cả hai
 * chặn request đi bằng khoá (lyDoChanDucPhien) TRƯỚC khi đúc; mục 4b kiểm kê MỌI chỗ đúc token để chỗ mới phải qua mắt người,
 * mục 6 chạy thật hai handler với storePrisma giả (không DB).
 */
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import { lyDoChanKhoa, lyDoChanGhi, lyDoChanJwtKhoa, khoaDoiDuocToken, lyDoChanDucPhien } from '../src/lib/phamViKhoaApi'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}
const GHI = ['POST', 'PUT', 'PATCH', 'DELETE']
const DOC = ['GET', 'HEAD', 'OPTIONS']

// 1. luật ghi (dùng chung X-API-Key + JWT)
dung('khoá read: đọc được, ghi / sửa / xoá bị chặn',
    DOC.every(m => lyDoChanGhi('read', m, '/api/products') === null) && GHI.every(m => !!lyDoChanGhi('read', m, '/api/products')))
dung('scope rỗng / null / thiếu ⇒ coi là read (không phải toàn quyền)',
    [undefined, null, '', 0].every(s => !!lyDoChanGhi(s, 'POST', '/api/products')))
dung('read,write / admin / * ghi được, không phân biệt hoa thường',
    ['read,write', 'admin', '*', 'ADMIN', 'Read,Write'].every(s => GHI.every(m => lyDoChanGhi(s, m, '/api/transactions') === null)))
dung('/api/mcp (JSON-RPC luôn POST) cho qua — mcp.ts tự kiểm tool.write',
    ['/api/mcp', '/api/mcp/', '/api/mcp?x=1'].every(u => lyDoChanGhi('read', 'POST', u) === null))
dung('đường giả dạng MCP vẫn bị chặn',
    ['/api/mcpx', '/api/mcp/tools', '/api/x/api/mcp', '/api/mcp-agent/run'].every(u => !!lyDoChanGhi('read', 'POST', u)))
dung('method lạ / viết thường ⇒ coi là ghi (chặn mặc định)', !!lyDoChanGhi('read', 'post', '/api/x') && !!lyDoChanGhi('read', 'PROPFIND', '/api/x') && !!lyDoChanGhi('read', undefined, '/api/x'))
dung('lý do chặn giữ nguyên câu cũ của nhánh X-API-Key', lyDoChanGhi('read', 'DELETE', '/api/x') === 'API key chỉ có quyền đọc — không thể ghi/sửa/xóa (scope=read)')
// POST /api/chatbot/webhook (n8n chuyển tin nhắn khách) là việc chính của khoá chatbot — trước đó luật ghi chặn nó 403
dung('khoá chatbot POST /api/chatbot/webhook được (lối riêng, chỉ đường này, chỉ POST)',
    lyDoChanGhi('chatbot', 'POST', '/api/chatbot/webhook') === null && lyDoChanGhi(' ChatBot ', 'POST', '/api/chatbot/webhook/?x=1') === null
    && !!lyDoChanGhi('chatbot', 'PUT', '/api/chatbot/webhook') && !!lyDoChanGhi('chatbot', 'DELETE', '/api/chatbot/webhook')
    && !!lyDoChanGhi('chatbot', 'POST', '/api/chatbot/webhook/x') && !!lyDoChanGhi('chatbot', 'POST', '/api/chatbot/shops') && !!lyDoChanGhi('chatbot', 'POST', '/api/chatbot/san-pham'))
dung('lối webhook KHÔNG mở cho khoá read (chỉ scope chatbot)', !!lyDoChanGhi('read', 'POST', '/api/chatbot/webhook') && !!lyDoChanGhi('', 'POST', '/api/chatbot/webhook'))
dung('khoá chatbot qua cả hai lớp ở /webhook (phạm vi đường + luật ghi); /shops (kho kiến thức) bị chặn cả đọc lẫn ghi',
    (lyDoChanKhoa('chatbot', '/api/chatbot/webhook') ?? lyDoChanGhi('chatbot', 'POST', '/api/chatbot/webhook')) === null
    && !!lyDoChanKhoa('chatbot', '/api/chatbot/shops') && !!(lyDoChanKhoa('chatbot', '/api/chatbot/shops/a') ?? lyDoChanGhi('chatbot', 'PUT', '/api/chatbot/shops/a')))

// 2. JWT: có claim ⇒ y hệt nhánh X-API-Key; không claim ⇒ không đụng
dung('JWT đăng nhập thường (không claim) không bị đụng',
    GHI.concat(DOC).every(m => lyDoChanJwtKhoa({ userId: 'u', role: 'admin', storeCode: 'HUTI' }, m, '/api/products') === null))
dung('payload không phải object ⇒ null, không ném lỗi',
    [undefined, null, 'chuoi', 42].every(p => lyDoChanJwtKhoa(p, 'POST', '/api/x') === null))
dung('JWT khoá read: GET qua, POST / PUT / PATCH / DELETE bị chặn',
    lyDoChanJwtKhoa({ apiKeyScopes: 'read' }, 'GET', '/api/customers') === null && GHI.every(m => !!lyDoChanJwtKhoa({ apiKeyScopes: 'read' }, m, '/api/customers')))
dung('JWT có claim rỗng / null ⇒ vẫn chỉ đọc (có mặt claim = token của khoá)',
    !!lyDoChanJwtKhoa({ apiKeyScopes: '' }, 'POST', '/api/x') && !!lyDoChanJwtKhoa({ apiKeyScopes: null }, 'DELETE', '/api/x'))
dung('JWT khoá read,write / admin ghi được', lyDoChanJwtKhoa({ apiKeyScopes: 'read,write' }, 'POST', '/api/products') === null && lyDoChanJwtKhoa({ apiKeyScopes: 'admin' }, 'DELETE', '/api/customers/1') === null)
dung('JWT khoá chatbot (lỡ có): như X-API-Key — GET /san-pham, POST /webhook; ngoài ra chặn',
    lyDoChanJwtKhoa({ apiKeyScopes: 'chatbot' }, 'GET', '/api/chatbot/san-pham?q=x') === null && lyDoChanJwtKhoa({ apiKeyScopes: 'chatbot' }, 'POST', '/api/chatbot/webhook') === null
    && !!lyDoChanJwtKhoa({ apiKeyScopes: 'chatbot' }, 'GET', '/api/customers') && !!lyDoChanJwtKhoa({ apiKeyScopes: 'chatbot' }, 'POST', '/api/chatbot/san-pham'))
const luoiScope = ['read', 'read,write', 'admin', '*', 'chatbot', '', null, 'readonly']
const luoiDuong = ['/api/products', '/api/mcp', '/api/chatbot/kenh', '/api/chatbot/webhook', '/api/chatbot/shops', '/api/livestream/state', '/api/auth/switch-branch']
const lech: string[] = []
for (const s of luoiScope) for (const m of [...DOC, ...GHI]) for (const u of luoiDuong) {
    const quaKhoa = lyDoChanKhoa(s, u) ?? lyDoChanGhi(s, m, u)   // nhánh X-API-Key: phạm vi đường (tryApiKeyAuth) rồi luật ghi
    if (lyDoChanJwtKhoa({ apiKeyScopes: s }, m, u) !== quaKhoa) lech.push(`${s} ${m} ${u}`)
}
dung(`JWT đổi từ khoá ≡ gọi bằng X-API-Key (${luoiScope.length * 7 * luoiDuong.length} tổ hợp scope × method × đường)`, lech.length === 0, lech.slice(0, 5))
dung('đổi phiên (POST /auth/switch-branch đúc refresh token) bị chặn với JWT khoá read', !!lyDoChanJwtKhoa({ apiKeyScopes: 'read' }, 'POST', '/api/auth/switch-branch'))
dung('khoá chatbot vẫn KHÔNG đổi được token (lớp chặn thứ hai)', !khoaDoiDuocToken('chatbot') && khoaDoiDuocToken('read') && khoaDoiDuocToken('admin'))

// 2b. ĐÚC PHIÊN (switch-branch → refresh token 90 ngày, livestream → studio token 12h): khoá KHÔNG được, kể cả admin / read,write
const GOI_Y = 'gợi ý thử'
dung('đúc phiên: cờ viaApiKey (X-API-Key / JWT đổi từ khoá) ⇒ chặn, kèm gợi ý',
    [true, 1, 'x'].every(c => String(lyDoChanDucPhien(c, { userId: 'u' }, GOI_Y)).endsWith(GOI_Y)))
dung('đúc phiên: payload có claim apiKeyScopes (kể cả admin / * / rỗng / null) ⇒ chặn dù thiếu cờ',
    ['admin', 'read,write', '*', 'read', '', null, undefined].every(s => !!lyDoChanDucPhien(undefined, { userId: 'u', apiKeyScopes: s }, GOI_Y)))
dung('đúc phiên: đăng nhập thường (không cờ, không claim) ⇒ cho qua',
    [undefined, false, 0, ''].every(c => lyDoChanDucPhien(c, { userId: 'u', role: 'admin', storeCode: 'HUTI' }, GOI_Y) === null)
    && [undefined, null, 'chuoi', 42].every(p => lyDoChanDucPhien(undefined, p, GOI_Y) === null))
dung('đúc phiên: lý do nói rõ bằng tiếng Việt', /^Khoá API không đúc được phiên đăng nhập mới/.test(String(lyDoChanDucPhien(true, {}, GOI_Y))))

// 3. nguồn
const doc = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const doan = (s: string, tu: string, den: string) => { const a = s.indexOf(tu); return a < 0 ? '' : s.slice(a, s.indexOf(den, a + tu.length) < 0 ? undefined : s.indexOf(den, a + tu.length)) }

const nguonAuth = doc('src/routes/auth.ts')
const token = doan(nguonAuth, "router.post('/token'", 'registerSseRefresh(')
const payload = doan(token, 'const payload = {', '}')
dung('/auth/token: claim apiKeyScopes trong payload JWT, giá trị = scope khoá (rỗng ⇒ read)',
    payload.includes('apiKeyScopes: scope') && token.includes("const scope = apiKey.scopes || 'read'"), payload)
dung('/auth/token: tính scope SAU khi khớp secret + khoaDoiDuocToken, TRƯỚC khi ký',
    token.indexOf('bcrypt.compare(clientSecret') < token.indexOf('khoaDoiDuocToken(apiKey.scopes)')
    && token.indexOf('khoaDoiDuocToken(apiKey.scopes)') < token.indexOf("const scope = apiKey.scopes || 'read'")
    && token.indexOf('apiKeyScopes: scope') < token.indexOf('jwt.sign(payload'))
dung("/auth/token: `scope` trả về = scope trong token (không còn mặc định 'admin')", /\n\s*scope,\r?\n/.test(token) && !token.includes("|| 'admin'"))
dung("claim KHÔNG tên 'scope' — admin / kiotviet / misa / livestream dùng claim đó cho token riêng", !/\bscope\s*:/.test(payload))

const nguonMw = doc('src/middleware/auth.ts')
const mw = doan(nguonMw, 'export const authMiddleware', 'export const optionalAuth')
const nhanhJwt = doan(mw, 'jwt.verify(', 'tryApiKeyAuth(req)')
dung('authMiddleware nhánh JWT: soát claim TRƯỚC next()',
    nhanhJwt.includes('lyDoChanJwtKhoa(decoded, req.method, req.originalUrl)') && nhanhJwt.indexOf('lyDoChanJwtKhoa(') < nhanhJwt.indexOf('next()'))
dung('authMiddleware nhánh JWT: gắn viaApiKey + apiKeyScopes cho mcp.ts / zalo.ts',
    nhanhJwt.includes('(req as any).viaApiKey = true') && nhanhJwt.includes("(req as any).apiKeyScopes = String(decoded.apiKeyScopes || 'read')"))
dung('authMiddleware nhánh X-API-Key: dùng lyDoChanGhi (một nguồn luật)',
    mw.indexOf('lyDoChanGhi((req as any).apiKeyScopes, req.method, req.originalUrl)') > mw.indexOf('tryApiKeyAuth(req)'))
dung('middleware/auth.ts không còn regex luật ghi riêng (chỉ ở lib/phamViKhoaApi.ts)', !nguonMw.includes('admin|write|'))

const nguonLs = doc('src/routes/livestream.ts')
const canh = doan(nguonLs, 'function requireToken', "router.get('/session-token'")
dung('livestream requireToken: soát claim trước next() (đường này không qua authMiddleware)',
    canh.includes('lyDoChanJwtKhoa(payload, req.method, req.originalUrl)') && canh.indexOf('lyDoChanJwtKhoa(') < canh.lastIndexOf('return next()'))
const st = doan(nguonLs, "router.get('/session-token'", 'function ensureTables')
dung('livestream /session-token: studio token 12h giữ claim của token khoá (lớp thứ hai)', st.includes('apiKeyScopes: payload.apiKeyScopes'))
const chanSt = st.indexOf('lyDoChanDucPhien(false, payload,')
dung('livestream /session-token: token khoá bị chặn 403 TRƯỚC khi ký studio token 12h',
    chanSt > 0 && chanSt < st.indexOf('jwt.sign(') && /^[^\n]*\n\s*if \(lyDoKhoa\) return res\.status\(403\)/.test(st.slice(chanSt)))

// switch-branch: chặn khoá TRƯỚC mọi truy vấn (await đầu tiên) và trước createTokenPair — refresh token 90 ngày không mang scope
const khoiTuyen = (nguon: string, dau: string) => {
    const a = nguon.indexOf(dau)
    if (a < 0) return ''
    const b = nguon.slice(a + dau.length).search(/\nrouter\.|\nregisterSseRefresh\(|\nexport default/)
    return nguon.slice(a, b < 0 ? undefined : a + dau.length + b)
}
const sb = khoiTuyen(nguonAuth, "router.post('/switch-branch'")
const chanSb = sb.indexOf('lyDoChanDucPhien((req as any).viaApiKey, req.user,')
dung('switch-branch: xét CẢ cờ viaApiKey (X-API-Key) lẫn claim trong req.user (JWT đổi từ khoá)', chanSb > 0, sb.slice(0, 400))
dung('switch-branch: chặn khoá TRƯỚC createTokenPair và trước mọi truy vấn (await đầu tiên)',
    chanSb > 0 && sb.includes('await createTokenPair(') && chanSb < sb.indexOf('await createTokenPair(') && chanSb < sb.indexOf('await '))
const doanChanSb = chanSb > 0 ? sb.slice(chanSb, sb.indexOf('await ')) : ''
dung('switch-branch: bị chặn ⇒ 403 rồi return NGAY, không chạy tiếp',
    /^[^\n]*\n\s*if \(lyDoKhoa\) \{\s*res\.status\(403\)\.json\(\{[^}]*\}\)\s*return\s*\}/.test(doanChanSb), doanChanSb)

// 4. chỗ MỚI tự jwt.verify phải được xem: JWT khoá có lách luật chỉ-đọc qua đó không?
const DA_SOAT: Record<string, string> = {
    'src/middleware/auth.ts': 'áp lyDoChanJwtKhoa',
    'src/routes/livestream.ts': 'requireToken áp lyDoChanJwtKhoa; session-token giữ claim',
    'src/lib/websocket.ts': 'chỉ đẩy sự kiện ra (đọc); tin vào chỉ có ping',
    'src/routes/admin.ts': "chỉ nhận token trang admin (scope PANEL + mfa)",
    'src/routes/kiotviet.ts': "chỉ nhận token trang admin (scope PANEL + mfa)",
    'src/routes/misa.ts': "chỉ nhận token trang admin (scope PANEL + mfa)",
    'src/routes/auth.ts': 'chỉ token đặt lại mật khẩu (purpose password_reset)',
    'src/routes/tarot.ts': "chỉ token typ 'tarot'",
}
const tatCaTep: string[] = []
const duyet = (thuMuc: string) => {
    for (const t of fs.readdirSync(path.join(__dirname, '..', thuMuc), { withFileTypes: true })) {
        const p = `${thuMuc}/${t.name}`
        if (t.isDirectory()) { if (t.name !== 'generated') duyet(p) } else if (/\.ts$/.test(t.name)) tatCaTep.push(p)
    }
}
duyet('src')
const tep = tatCaTep.filter(p => doc(p).includes('jwt.verify('))
const moi = tep.filter(p => !DA_SOAT[p])
dung(`mọi chỗ tự jwt.verify (${tep.length} tệp) đã được soát với claim apiKeyScopes — tệp mới: xem rồi thêm vào DA_SOAT`, moi.length === 0 && tep.length > 0, moi)

// 4b. mọi chỗ ĐÚC token: chỗ mới ⇒ đỏ đến khi có người xem. Đúc từ request ĐÃ xác thực thì phải lyDoChanDucPhien trước khi ký.
// createTokenPair (access + refresh token 90 ngày lưu CSDL) soát theo từng tuyến của routes/auth.ts
const TUYEN_DUC_CAP = new Set(['/signup', '/login', '/verify-2fa', '/verify-otp', '/switch-branch'])   // 4 tuyến đầu: chưa xác thực (đăng ký / mật khẩu / mã)
const tuyenAuth = [...nguonAuth.matchAll(/\nrouter\.(get|post|put|patch|delete)\('([^']+)'/g)]
const ducCap: { duong: string; xacThuc: boolean; chanTruoc: boolean }[] = []
tuyenAuth.forEach((m, i) => {
    const het = i + 1 < tuyenAuth.length ? tuyenAuth[i + 1].index : nguonAuth.indexOf('\nregisterSseRefresh(')
    const khoi = nguonAuth.slice(m.index!, het !== undefined && het >= 0 ? het : undefined)
    const duc = khoi.indexOf('createTokenPair(')
    if (duc < 0) return
    const chan = khoi.indexOf('lyDoChanDucPhien(')
    ducCap.push({ duong: m[2], xacThuc: /authMiddleware|optionalAuth|sseAuthMiddleware|apiKeyAuth/.test(khoi.slice(0, khoi.indexOf('=>'))), chanTruoc: chan >= 0 && chan < duc })
})
dung(`createTokenPair chỉ ở ${TUYEN_DUC_CAP.size} tuyến đã soát — tuyến mới: xem rồi thêm vào TUYEN_DUC_CAP`,
    ducCap.length === TUYEN_DUC_CAP.size && ducCap.every(t => TUYEN_DUC_CAP.has(t.duong)), ducCap.map(t => t.duong))
dung('tuyến ĐÃ xác thực gọi createTokenPair ⇒ lyDoChanDucPhien đứng trước (hiện chỉ switch-branch)',
    ducCap.some(t => t.xacThuc) && ducCap.filter(t => t.xacThuc).every(t => t.chanTruoc), ducCap.filter(t => t.xacThuc))
dung('createTokenPair không xuất ra / không gọi ngoài routes/auth.ts',
    !/export\s+(async\s+)?function\s+createTokenPair|export\s*\{[^}]*\bcreateTokenPair\b/.test(nguonAuth)
    && tatCaTep.every(p => p === 'src/routes/auth.ts' || !/\bcreateTokenPair\s*\(/.test(doc(p))),
    tatCaTep.filter(p => p !== 'src/routes/auth.ts' && /\bcreateTokenPair\s*\(/.test(doc(p))))
// jwt.sign đếm theo tệp — số đổi ⇒ xem chỗ mới có đúc phiên từ request đi bằng khoá không, rồi sửa DA_SOAT_KY
const DA_SOAT_KY: Record<string, [number, string]> = {
    'src/routes/auth.ts': [5, 'createTokenPair (tuyến ở TUYEN_DUC_CAP); /refresh + SSE (đổi từ refresh token); token đặt lại mật khẩu; /token (mang apiKeyScopes, 1h)'],
    'src/routes/admin.ts': [1, 'token trang admin — sau mật khẩu + mã 2 bước, không từ request đã xác thực'],
    'src/routes/livestream.ts': [1, 'studio token 12h — lyDoChanDucPhien chặn token khoá trước khi ký'],
    'src/routes/tarot.ts': [1, "token typ 'tarot' — tài khoản tarot riêng (Google), không phải tài khoản cửa hàng"],
}
const soKy: Record<string, number> = {}
for (const p of tatCaTep) { const n = (doc(p).match(/jwt\.sign\(/g) || []).length; if (n) soKy[p] = n }
const lechKy = [...new Set([...Object.keys(soKy), ...Object.keys(DA_SOAT_KY)])].filter(p => (soKy[p] || 0) !== (DA_SOAT_KY[p]?.[0] || 0))
dung(`mọi chỗ jwt.sign (${Object.values(soKy).reduce((a, b) => a + b, 0)} chỗ / ${Object.keys(soKy).length} tệp) đã soát — số đổi: xem rồi sửa DA_SOAT_KY`,
    lechKy.length === 0 && Object.keys(soKy).length > 0, lechKy.map(p => `${p}: có ${soKy[p] || 0}, đã soát ${DA_SOAT_KY[p]?.[0] || 0}`))
// Mỗi DÒNG nhắc 'jsonwebtoken' phải đúng dạng import mặc định (import type thì vô hại) — so theo dòng vì repo không dùng dấu ';'
const dongJwtLa = tatCaTep.flatMap(p => doc(p).split('\n').filter(d => /['"]jsonwebtoken['"]/.test(d)
    && !/^\s*import\s+jwt\s+from\s+['"]jsonwebtoken['"]\s*;?\s*$/.test(d) && !/^\s*import\s+type\s/.test(d)).map(d => `${p}: ${d.trim()}`))
dung('jsonwebtoken chỉ import mặc định (import jwt from …) — import tên lẻ / require lọt mắt hai phép đếm jwt.verify( / jwt.sign(',
    dongJwtLa.length === 0 && tatCaTep.some(p => doc(p).includes("import jwt from 'jsonwebtoken'")), dongJwtLa)

// 5. authMiddleware chạy THẬT với JWT ký bằng khoá thử — không storeId / schema ⇒ không đụng registry
;(async () => {
    process.env.JWT_SECRET = 'khoa-thu-check-pham-vi-khoa'
    process.env.DATABASE_URL = 'postgresql://khong-dung-db@127.0.0.1:9/khong'   // phòng hờ: bộ soát không bao giờ chạm CSDL thật
    process.env.LIVESTREAM_ALLOWED_STORES = 'KENGIONLINE'
    const { authMiddleware } = await import('../src/middleware/auth')
    const chay = async (claim: Record<string, unknown>, method: string, url: string, khoa = process.env.JWT_SECRET!) => {
        const tok = jwt.sign({ userId: 'u1', email: 'a@b.c', role: 'admin', ...claim }, khoa, { algorithm: 'HS256', expiresIn: '5m' })
        const req: any = { headers: { authorization: `Bearer ${tok}` }, method, originalUrl: url }
        const res: any = { ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } }
        let qua = false
        await authMiddleware(req, res, () => { qua = true })
        return { qua, ma: res.ma, loi: res.than?.error, scope: req.apiKeyScopes, viaKey: req.viaApiKey }
    }
    const a = await chay({}, 'POST', '/api/products')
    dung('chạy thật: JWT đăng nhập POST ⇒ qua, không gắn cờ khoá', a.qua && a.ma === 200 && !a.viaKey && a.scope === undefined, a)
    const b = await chay({ apiKeyScopes: 'read' }, 'POST', '/api/products')
    dung('chạy thật: JWT khoá read POST ⇒ 403, KHÔNG gọi next', !b.qua && b.ma === 403 && /chỉ có quyền đọc/.test(String(b.loi)), b)
    const c = await chay({ apiKeyScopes: 'read' }, 'DELETE', '/api/customers/x')
    dung('chạy thật: JWT khoá read DELETE ⇒ 403', !c.qua && c.ma === 403, c)
    const d = await chay({ apiKeyScopes: 'read' }, 'GET', '/api/online-orders/packing-list')
    dung('chạy thật: JWT khoá read GET ⇒ qua, gắn viaApiKey + scope read', d.qua && d.viaKey === true && d.scope === 'read', d)
    const e = await chay({ apiKeyScopes: 'read' }, 'POST', '/api/mcp')
    dung('chạy thật: JWT khoá read POST /api/mcp ⇒ qua với scope read (mcp.ts chặn tool ghi)', e.qua && e.scope === 'read', e)
    const f = await chay({ apiKeyScopes: 'admin' }, 'DELETE', '/api/products/x')
    dung('chạy thật: JWT khoá admin (khoá "API Secret") DELETE ⇒ qua như cũ', f.qua && f.scope === 'admin', f)
    const g = await chay({ apiKeyScopes: '' }, 'PUT', '/api/products/x')
    dung('chạy thật: claim rỗng PUT ⇒ 403', !g.qua && g.ma === 403, g)
    const h = await chay({ apiKeyScopes: 'chatbot' }, 'GET', '/api/customers')
    dung('chạy thật: JWT chatbot (lỡ có) GET /api/customers ⇒ 403', !h.qua && h.ma === 403, h)
    const h2 = await chay({ apiKeyScopes: 'chatbot' }, 'POST', '/api/chatbot/webhook')
    dung('chạy thật: JWT chatbot (lỡ có) POST /api/chatbot/webhook ⇒ qua', h2.qua && h2.scope === 'chatbot', h2)
    const i = await chay({ apiKeyScopes: 'admin' }, 'POST', '/api/products', 'khoa-gia-mao')
    dung('chạy thật: JWT ký sai khoá ⇒ 401 (không tin claim của token giả)', !i.qua && i.ma === 401, i)

    // 6. hai chỗ đúc phiên chạy THẬT: lấy đúng các bước của tuyến trong router; storePrisma giả ghi lại mọi truy vấn, trả null
    const cacBuoc = (router: any, method: string, duong: string): Function[] =>
        router.stack.find((l: any) => l.route?.path === duong && l.route.methods[method])?.route.stack.map((l: any) => l.handle) || []
    const resGia = () => ({ ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } })
    const kyThu = (claim: Record<string, unknown>) =>
        jwt.sign({ userId: 'u1', email: 'a@b.c', role: 'admin', storeCode: 'KENGIONLINE', ...claim }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' })

    const { default: authRouter } = await import('../src/routes/auth')
    const buocSb = cacBuoc(authRouter, 'post', '/switch-branch')
    dung('tìm được POST /switch-branch trong router: authMiddleware + handler', buocSb.length === 2 && buocSb[0] === authMiddleware, buocSb.length)
    const doiChiNhanh = async (claim: Record<string, unknown> | null) => {
        const goi: string[] = []
        const prismaGia: any = new Proxy({}, { get: (_m, model) => new Proxy({}, { get: (_f, fn) => async () => { goi.push(`${String(model)}.${String(fn)}`); return null } }) })
        const req: any = { headers: {}, method: 'POST', originalUrl: '/api/auth/switch-branch', body: { branchId: 'cn-2' }, storePrisma: prismaGia }
        let buoc = buocSb
        if (claim) req.headers.authorization = `Bearer ${kyThu(claim)}`
        else {   // X-API-Key: khớp khoá cần CSDL ⇒ gắn sẵn đúng thứ tryApiKeyAuth gắn (không claim trong req.user), chạy từ handler
            Object.assign(req, { user: { userId: 'u1', email: 'a@b.c', role: 'admin' }, viaApiKey: true, apiKeyScopes: 'admin' })
            buoc = buocSb.slice(1)
        }
        const res = resGia()
        for (const b of buoc) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
        return { ma: res.ma, loi: res.than?.error, refreshToken: res.than?.data?.refreshToken, goi }
    }
    const s1 = await doiChiNhanh({ apiKeyScopes: 'admin' })
    dung('chạy thật: JWT khoá admin ("API Secret") POST /switch-branch ⇒ 403, KHÔNG truy vấn, KHÔNG refresh token',
        s1.ma === 403 && /không đúc được phiên/.test(String(s1.loi)) && s1.goi.length === 0 && !s1.refreshToken, s1)
    const s2 = await doiChiNhanh({ apiKeyScopes: 'read,write' })
    dung('chạy thật: JWT khoá read,write POST /switch-branch ⇒ 403, không truy vấn', s2.ma === 403 && s2.goi.length === 0, s2)
    const s3 = await doiChiNhanh(null)
    dung('chạy thật: X-API-Key (chỉ cờ viaApiKey, không claim) POST /switch-branch ⇒ 403, không truy vấn', s3.ma === 403 && s3.goi.length === 0, s3)
    const s4 = await doiChiNhanh({ apiKeyScopes: 'read' })
    dung('chạy thật: JWT khoá read ⇒ authMiddleware chặn (luật ghi) trước cả handler', s4.ma === 403 && /chỉ có quyền đọc/.test(String(s4.loi)) && s4.goi.length === 0, s4)
    const s5 = await doiChiNhanh({})
    dung('chạy thật: JWT đăng nhập thường QUA lớp chặn, đi tiếp tra chi nhánh (giả: không có ⇒ 404)', s5.ma === 404 && s5.goi[0] === 'branch.findUnique', s5)

    const { default: lsRouter } = await import('../src/routes/livestream')
    const buocSt = cacBuoc(lsRouter, 'get', '/session-token')
    const layStudio = async (claim: Record<string, unknown>) => {
        const req: any = { headers: { authorization: `Bearer ${kyThu(claim)}` }, method: 'GET', originalUrl: '/api/livestream/session-token', query: {} }
        const res = resGia()
        for (const b of buocSt) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
        const tok = res.than?.data?.studioToken
        return { ma: res.ma, loi: res.than?.error, studio: tok ? jwt.decode(tok) as Record<string, unknown> : null }
    }
    const l1 = await layStudio({})
    dung('chạy thật: đăng nhập thường đổi studio token 12h như cũ (không claim khoá)',
        buocSt.length === 1 && l1.ma === 200 && l1.studio?.scope === 'livestream-studio' && !('apiKeyScopes' in (l1.studio || {})), l1)
    const l2 = await layStudio({ apiKeyScopes: 'admin' })
    dung('chạy thật: token đổi từ khoá admin KHÔNG đổi được studio token 12h ⇒ 403', l2.ma === 403 && !l2.studio && /không đúc được phiên/.test(String(l2.loi)), l2)

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
})().catch(e => { console.error('✗ bộ soát lỗi:', e); process.exit(1) })
