/**
 * Bộ soát PHẠM VI API KEY ĐI THEO JWT (lib/phamViKhoaApi.ts + middleware/auth.ts + /auth/token + livestream) — 20/10/2026.
 *   npx tsx scripts/check-pham-vi-khoa.ts
 * Sự cố: POST /api/auth/token đổi khoá thành JWT 1 giờ mà JWT KHÔNG mang scope ⇒ khoá 'read' đổi token là có JWT toàn quyền
 * người tạo khoá (ghi / sửa / xoá được hết; nhánh X-API-Key thì chặn). Nay JWT mang claim apiKeyScopes và mọi chỗ nhận JWT
 * áp CÙNG một luật với nhánh X-API-Key. Không DB: authMiddleware chạy thật với JWT ký bằng khoá thử (không storeId ⇒ không
 * tra registry), còn /auth/token + livestream soát bằng đọc nguồn.
 * Kèm: khoá 'chatbot' POST /api/chatbot/webhook phải QUA luật ghi — webhook thêm cùng ngày, luật ghi cũ chặn nó 403
 * (bộ soát chatbot chỉ thử phạm vi đường nên không thấy).
 */
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import { lyDoChanKhoa, lyDoChanGhi, lyDoChanJwtKhoa, khoaDoiDuocToken } from '../src/lib/phamViKhoaApi'

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
dung('livestream /session-token: studio token 12h giữ claim của token khoá',
    doan(nguonLs, "router.get('/session-token'", 'function ensureTables').includes('apiKeyScopes: payload.apiKeyScopes'))

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
const tep: string[] = []
const duyet = (thuMuc: string) => {
    for (const t of fs.readdirSync(path.join(__dirname, '..', thuMuc), { withFileTypes: true })) {
        const p = `${thuMuc}/${t.name}`
        if (t.isDirectory()) { if (t.name !== 'generated') duyet(p) } else if (/\.ts$/.test(t.name) && doc(p).includes('jwt.verify(')) tep.push(p)
    }
}
duyet('src')
const moi = tep.filter(p => !DA_SOAT[p])
dung(`mọi chỗ tự jwt.verify (${tep.length} tệp) đã được soát với claim apiKeyScopes — tệp mới: xem rồi thêm vào DA_SOAT`, moi.length === 0 && tep.length > 0, moi)

// 5. authMiddleware chạy THẬT với JWT ký bằng khoá thử — không storeId / schema ⇒ không đụng registry
;(async () => {
    process.env.JWT_SECRET = 'khoa-thu-check-pham-vi-khoa'
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

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
})().catch(e => { console.error('✗ bộ soát lỗi:', e); process.exit(1) })
