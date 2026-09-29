/**
 * KIỂM MARKETING STUDIO NHIỀU THƯƠNG HIỆU  —  npm run check:mkt
 *
 * Chạy THẲNG các route thật của src/routes/mktStudio.ts và worker thật
 * (src/services/mktDangBai.ts) trên một prisma GIẢ trong bộ nhớ — không đụng DB
 * thật (máy dev trỏ .env vào DB PROD, nên chạy server thử là ghi vào cửa hàng thật).
 *
 * Soát đúng những ranh giới mà hỏng là hại thật:
 *   · dữ liệu KHÔNG lọt chéo thương hiệu (AI viết cho A thấy giá của B)
 *   · trần 10 thương hiệu, xoá mềm, không xoá khi còn bài đang chờ
 *   · hồ sơ cập nhật TỪNG PHẦN (không xoá trắng trường không gửi)
 *   · sửa phiên bản theo kênh là MẤT DUYỆT; duyệt bản cũ bị từ chối
 *   · worker đăng ĐÚNG phiên bản của kênh
 */
/* ⛔ .env của máy dev trỏ vào DB PROD. Bộ kiểm KHÔNG được có đường nào tới đó: trỏ mọi
 * URL database vào một cổng chết TRƯỚC khi nạp bất kỳ module nào (vì vậy dùng import
 * động bên dưới — import tĩnh bị kéo lên đầu file, chạy trước dòng này). */
process.env.DATABASE_URL = 'postgresql://khong:khong@127.0.0.1:1/khong-bao-gio'
process.env.DIRECT_URL = process.env.DATABASE_URL
process.env.MARKETING_VAULT_KEY = 'a'.repeat(64)
let mktRouter: any, dangMotViec: any, khaiNenTang: any, maHoa: any

// ─── Prisma giả ──────────────────────────────────────────────────────────────
let dem = 0
const moiId = () => 'id' + (++dem).toString().padStart(4, '0')
const MAC_DINH: Record<string, any> = {
    mktBrand: {
        industry: '', description: '', products: '', contentPillars: '', contact: '', audience: '',
        voice: '', usp: '', cta: '', examples: '', notes: '', bannedWords: '[]',
        timezone: 'Asia/Ho_Chi_Minh', archivedAt: null, brandId: undefined,
    },
    mktAccount: { brandId: null, status: 'active', refreshSecret: null },
    mktCampaign: { brandId: null, status: 'active', goal: '' },
    mktContent: {
        brandId: null, campaignId: null, title: '', body: '', hashtags: '[]', assetIds: '[]',
        productIds: '[]', variants: '[]', revision: 1, approvedRevision: null, status: 'draft',
    },
    mktPublication: { status: 'queued', remoteRef: null, attempts: 0 },
    mktAsset: { brandId: null, localFile: '', name: '', type: 'image' },
}
const bang: Record<string, any[]> = {
    mktBrand: [], mktAccount: [], mktCampaign: [], mktContent: [], mktPublication: [], mktAsset: [],
    fbBrandProfile: [],
}

function khop(model: string, dong: any, where: any = {}): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === 'content' && model === 'mktPublication') {
            const c = bang.mktContent.find(x => x.id === dong.contentId)
            if (!c || !khop('mktContent', c, v)) return false
            continue
        }
        if (k === 'platform_externalId') {
            if (dong.platform !== (v as any).platform || dong.externalId !== (v as any).externalId) return false
            continue
        }
        if (v && typeof v === 'object' && !(v instanceof Date)) {
            const o: any = v
            if ('in' in o && !o.in.includes(dong[k])) return false
            if ('lt' in o && !(dong[k] < o.lt)) return false
            if ('lte' in o && !(dong[k] <= o.lte)) return false
            continue
        }
        if (v === null ? dong[k] != null : dong[k] !== v) return false
    }
    return true
}
function mo(model: string) {
    const ds = () => bang[model]
    const kem = (d: any, include: any) => {
        if (!d) return d
        const r = { ...d }   // BẢN SAO như Prisma thật — trả object gốc thì update sau làm đổi biến cũ
        if (!include) return r
        if (include.publications) r.publications = bang.mktPublication.filter(p => p.contentId === d.id)
        if (include.content) r.content = { ...bang.mktContent.find(c => c.id === d.contentId) }
        if (include.account) r.account = bang.mktAccount.find(a => a.id === d.accountId)
        return r
    }
    return {
        findMany: async ({ where, orderBy, take, include }: any = {}) => {
            let r = ds().filter(d => khop(model, d, where))
            if (orderBy) {
                const [k, huong] = Object.entries(orderBy)[0] as [string, string]
                r = [...r].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (huong === 'desc' ? -1 : 1))
            }
            return r.slice(0, take ?? r.length).map(d => kem(d, include))
        },
        findFirst: async ({ where, include }: any = {}) => kem(ds().find(d => khop(model, d, where)) || null, include),
        findUnique: async ({ where, include }: any) => kem(ds().find(d => khop(model, d, where)) || null, include),
        count: async ({ where }: any = {}) => ds().filter(d => khop(model, d, where)).length,
        create: async ({ data }: any) => {
            const t = new Date(Date.now() + dem)   // thứ tự tạo phân biệt được
            const d = { id: moiId(), ...(MAC_DINH[model] || {}), ...data, createdAt: t, updatedAt: t }
            ds().push(d)
            return { ...d }
        },
        update: async ({ where, data }: any) => {
            const d = ds().find(x => khop(model, x, where))
            if (!d) throw new Error(`update: không có ${model}`)
            Object.assign(d, data, { updatedAt: new Date() })
            return { ...d }
        },
        updateMany: async ({ where, data }: any) => {
            const r = ds().filter(d => khop(model, d, where))
            for (const d of r) Object.assign(d, data)
            return { count: r.length }
        },
        deleteMany: async ({ where }: any) => {
            const truoc = ds().length
            bang[model] = ds().filter(d => !khop(model, d, where))
            return { count: truoc - bang[model].length }
        },
        upsert: async ({ where, create, update }: any) => {
            const d = ds().find(x => khop(model, x, where))
            if (d) { Object.assign(d, update); return { ...d } }
            const moi = { id: moiId(), ...(MAC_DINH[model] || {}), ...create, createdAt: new Date(), updatedAt: new Date() }
            ds().push(moi)
            return { ...moi }
        },
    }
}
const prisma: any = new Proxy({}, { get: (_t, k: string) => mo(k) })

// ─── Gọi route thật, bỏ qua authMiddleware (lớp đầu) ─────────────────────────
async function goi(method: string, path: string, { body, brand, role = 'admin', query = {} }: any = {}) {
    const stack: any[] = (mktRouter as any).stack
    let params: any = {}
    const lop = stack.find(l => {
        if (!l.route || !l.route.methods[method.toLowerCase()]) return false
        const m = l.match(path)
        if (m) params = l.params
        return m
    })
    if (!lop) throw new Error(`không có route ${method} ${path}`)
    const req: any = {
        method, body, params, query, headers: brand ? { 'x-mkt-brand': brand } : {},
        user: { userId: 'u1', role, branchSchema: 'branch_test' }, storePrisma: prisma,
    }
    let ketQua: any = null
    const res: any = {
        statusCode: 200,
        status(c: number) { this.statusCode = c; return this },
        json(j: any) { ketQua = { status: this.statusCode, ...j }; return this },
    }
    const cacLop = lop.route.stack.slice(1).map((s: any) => s.handle)   // bỏ authMiddleware
    for (const h of cacLop) {
        let tiep = false
        await h(req, res, () => { tiep = true })
        if (!tiep) break
    }
    return ketQua
}

let dat = 0, truot = 0
function kiem(ten: string, dung: boolean, chiTiet?: any) {
    if (dung) { dat++; console.log('  ✅', ten) }
    else { truot++; console.log('  ❌', ten, chiTiet !== undefined ? JSON.stringify(chiTiet).slice(0, 300) : '') }
}

async function main() {
    mktRouter = (await import('../src/routes/mktStudio')).default
    ;({ dangMotViec, khaiNenTang } = await import('../src/services/mktDangBai'))
    ;({ maHoa } = await import('../src/lib/maHoaKhoa'))
    const { registryPrisma } = await import('../src/lib/prisma')
    /* Registry giả: route bật cờ hasMarketing qua registry — ghi lại thay vì đi ra mạng. */
    const coBat: string[] = []
    ;(registryPrisma as any).store = { updateMany: async ({ where }: any) => { coBat.push(where.schema); return { count: 1 } } }
    ;(globalThis as any).__coBat = coBat
    // Dữ liệu CŨ trước 29/09: hồ sơ Content AI + một kênh + một bài chưa có brandId
    bang.fbBrandProfile.push({ id: 'fb1', brandName: 'Kengi Store', industry: 'giày dép', toneOfVoice: 'hai-huoc', bannedWords: '["xả kho"]', usp: 'chính hãng', cta: 'Inbox', audience: 'nữ 25-40', notes: '' })
    bang.mktAccount.push({ id: 'accCu', brandId: null, platform: 'facebook', externalId: 'p1', name: 'Page cũ', status: 'active', accessToken: maHoa('tok'), createdAt: new Date(0) })
    bang.mktContent.push({ id: 'ctCu', ...MAC_DINH.mktContent, body: 'bài cũ', createdAt: new Date(0), updatedAt: new Date(0) })

    console.log('━━ Thương hiệu đầu tiên dựng từ hồ sơ cũ')
    let s = await goi('GET', '/state')
    const A = s.data?.brand?.id
    kiem('state trả thương hiệu đầu tiên', s.success && !!A, s)
    kiem('tên + ngành + từ cấm lấy từ FbBrandProfile', s.data.brand.name === 'Kengi Store' && s.data.brand.industry === 'giày dép' && s.data.brand.bannedWords[0] === 'xả kho', s.data.brand)
    kiem('giọng văn cũ "hai-huoc" đổi thành chữ', s.data.brand.voice === 'Hài hước, dí dỏm', s.data.brand.voice)
    kiem('hồ sơ trả ĐỦ trường, trống là ""', s.data.brand.products === '' && s.data.brand.contact === '', s.data.brand)
    kiem('kênh + bài cũ (brandId null) được gán vào thương hiệu đầu tiên', s.data.accounts.length === 1 && s.data.contents.length === 1)
    kiem('token KHÔNG lọt ra ngoài', !JSON.stringify(s).includes('accessToken') && s.data.accounts[0].coToken === true)
    s = await goi('GET', '/state')
    kiem('gọi lại không đẻ thêm thương hiệu', bang.mktBrand.length === 1)

    console.log('━━ Nhiều thương hiệu, trần 10')
    const tao = await goi('POST', '/brands', { body: { name: 'Trà Sữa Mây' } })
    const B = tao.data?.id
    kiem('tạo thương hiệu thứ hai → 201', tao.status === 201 && !!B, tao)
    kiem('nhân viên (staff) không tạo được thương hiệu', (await goi('POST', '/brands', { body: { name: 'x' }, role: 'staff' })).status === 403)
    kiem('tên rỗng bị từ chối', (await goi('POST', '/brands', { body: { name: '  ' } })).status === 400)
    for (let i = 3; i <= 10; i++) await goi('POST', '/brands', { body: { name: 'TH ' + i } })
    const vuot = await goi('POST', '/brands', { body: { name: 'TH 11' } })
    kiem('thương hiệu thứ 11 → 409 BRAND_LIMIT', vuot.status === 409 && vuot.code === 'BRAND_LIMIT', vuot)
    s = await goi('GET', '/state', { brand: B })
    kiem('header x-mkt-brand chọn đúng thương hiệu', s.data.brand.name === 'Trà Sữa Mây' && s.data.brands.length === 10, s.data?.brand)
    kiem('thương hiệu mới KHÔNG thấy kênh/bài của thương hiệu đầu', s.data.accounts.length === 0 && s.data.contents.length === 0)
    const la = await goi('GET', '/state', { brand: 'khong-co' })
    kiem('id thương hiệu lạ → 404, KHÔNG rơi về thương hiệu khác', la.status === 404 && la.code === 'BRAND_NOT_FOUND', la)

    console.log('━━ Hồ sơ cập nhật từng phần')
    await goi('PUT', '/brand', { brand: B, body: { description: 'Trà sữa nấu tay', products: 'Trà sữa mây – 35.000đ' } })
    let h = await goi('PUT', '/brand', { brand: B, body: { contentPillars: 'Hậu trường · Công thức' } })
    kiem('gửi một trường không xoá trắng trường khác', h.data.description === 'Trà sữa nấu tay' && h.data.products === 'Trà sữa mây – 35.000đ' && h.data.contentPillars === 'Hậu trường · Công thức', h.data)
    kiem('trường lạ bị từ chối', (await goi('PUT', '/brand', { brand: B, body: { slogan: 'x' } })).status === 400)
    kiem('bannedWords sai kiểu bị từ chối', (await goi('PUT', '/brand', { brand: B, body: { bannedWords: 'rẻ nhất' } })).status === 400)
    kiem('múi giờ sai bị từ chối', (await goi('PUT', '/brand', { brand: B, body: { timezone: 'Mars/Base' } })).status === 400)
    h = await goi('PUT', '/brand', { brand: B, body: { bannedWords: ['rẻ nhất'] } })
    kiem('bannedWords lưu và trả về dạng mảng', Array.isArray(h.data.bannedWords) && h.data.bannedWords[0] === 'rẻ nhất', h.data)
    kiem('hồ sơ thương hiệu đầu KHÔNG bị đụng', (await goi('GET', '/brand', { brand: A })).data.products === '')

    console.log('━━ Không lọt chéo thương hiệu')
    bang.mktAccount.push({ id: 'accB', brandId: B, platform: 'facebook', externalId: 'p2', name: 'Page Mây', status: 'active', accessToken: maHoa('tokB'), createdAt: new Date() })
    const cheo = await goi('POST', '/contents', { brand: A, body: { body: 'x', variants: [{ accountId: 'accB', text: 'y' }] } })
    kiem('bài của A không được gắn kênh của B', cheo.status === 400 && cheo.code === 'SAI_THUONG_HIEU', cheo)
    bang.mktAsset.push({ id: 'assetB', brandId: B, localFile: '', type: 'image', url: 'https://cdn.example.com/b.jpg', createdAt: new Date() })
    const cheoMedia = await goi('POST', '/contents', { brand: A, body: { body: 'x', assetIds: ['assetB'] } })
    kiem('bài của A không được dùng media của B', cheoMedia.status === 400, cheoMedia)
    const xoaCheo = await goi('DELETE', '/accounts/accB', { brand: A })
    kiem('A không xoá được kênh của B', xoaCheo.status === 404 && bang.mktAccount.some(a => a.id === 'accB'), xoaCheo)

    console.log('━━ Phiên bản theo kênh + luật mất duyệt')
    const bai = await goi('POST', '/contents', { brand: B, body: { title: 'Ra mắt', variants: [{ accountId: 'accB', text: 'Bản riêng cho Page Mây' }] } })
    kiem('tạo bài chỉ có phiên bản riêng (không có thân chung)', bai.success && bai.data.variants[0].text === 'Bản riêng cho Page Mây', bai)
    const id = bai.data.id
    const duyet = await goi('POST', `/contents/${id}/approve`, { brand: B, body: { revision: 1 } })
    kiem('duyệt đúng revision', duyet.success && duyet.data.approvedRevision === 1, duyet)
    const sua = await goi('PATCH', `/contents/${id}`, { brand: B, body: { variants: [{ accountId: 'accB', text: 'Đã sửa' }] } })
    kiem('sửa phiên bản → MẤT DUYỆT', sua.matDuyet === true && sua.data.approvedRevision === null && sua.data.revision === 2, sua)
    const duyetCu = await goi('POST', `/contents/${id}/approve`, { brand: B, body: { revision: 1 } })
    kiem('duyệt bản cũ (revision 1) bị từ chối', duyetCu.status === 409 && duyetCu.code === 'REVISION_CU', duyetCu)
    kiem('chưa duyệt thì không lên lịch được', (await goi('POST', `/contents/${id}/schedule`, { brand: B, body: {} })).code === 'CHUA_DUYET')
    await goi('POST', `/contents/${id}/approve`, { brand: B, body: { revision: 2 } })
    const lich = await goi('POST', `/contents/${id}/schedule`, { brand: B, body: {} })
    kiem('không chọn kênh → lấy kênh từ phiên bản', lich.data?.daTao === 1, lich)
    const lich2 = await goi('POST', `/contents/${id}/schedule`, { brand: B, body: {} })
    kiem('lên lịch lần hai không đẻ thêm bài (idempotent)', lich2.data?.daTao === 0 && bang.mktPublication.length === 1, lich2)
    kiem('lên lịch bật cờ hasMarketing cho worker', (globalThis as any).__coBat.includes('branch_test'))
    kiem('A không thấy lượt đăng của B', (await goi('GET', '/publications', { brand: A })).data.length === 0)
    const huyCheo = await goi('POST', `/publications/${bang.mktPublication[0].id}/cancel`, { brand: A })
    kiem('A không huỷ được lượt đăng của B', huyCheo.status === 409 && bang.mktPublication[0].status === 'queued', huyCheo)

    console.log('━━ Worker đăng đúng phiên bản của kênh')
    let daGui: any = null
    khaiNenTang('facebook', { dang: async (_tk, token, b) => { daGui = { token, body: b.body }; return { remotePostId: 'fb_1' } } })
    const viec = { ...bang.mktPublication[0], content: { ...bang.mktContent.find(c => c.id === id) }, account: bang.mktAccount.find(a => a.id === 'accB') }
    const kq = await dangMotViec(prisma, viec)
    kiem('gửi phiên bản riêng, không phải thân chung', kq === 'da-gui' && daGui?.body === 'Đã sửa', { kq, daGui })
    kiem('token được giải mã đúng trước khi gửi', daGui?.token === 'tokB')

    // Media thật + gia hạn token Threads còn 2 ngày (Threads phải gia hạn khi CÒN hạn)
    bang.mktAccount.push({ id: 'accTh', brandId: B, platform: 'threads', externalId: 't1', name: 'Threads Mây', status: 'active', accessToken: maHoa('tokCu'), tokenExpiresAt: new Date(Date.now() + 2 * 86400_000), createdAt: new Date() })
    bang.mktAsset.push({ id: 'anh1', brandId: B, type: 'image', mime: 'image/jpeg', url: 'https://storage.googleapis.com/kengi-tech-assets/mkt/x.jpg', storagePath: 'mkt/x.jpg', localFile: '', createdAt: new Date() })
    const baiAnh = { id: 'ctAnh', ...MAC_DINH.mktContent, brandId: B, revision: 1, approvedRevision: 1, variants: JSON.stringify([{ accountId: 'accTh', text: 'Có ảnh', assetIds: ['anh1'] }]) }
    bang.mktContent.push(baiAnh)
    const fetchCu = globalThis.fetch
    ;(globalThis as any).fetch = async (url: string) => {
        if (!String(url).includes('th_refresh_token')) throw new Error('không được gọi mạng khác: ' + url)
        return new Response(JSON.stringify({ access_token: 'tokMoi', expires_in: 5184000 }), { status: 200 })
    }
    let guiTh: any = null
    khaiNenTang('threads', { dang: async (_tk: any, token: string, b: any) => { guiTh = { token, assets: b.assets }; return { remotePostId: 'th_1' } } })
    const kqTh = await dangMotViec(prisma, { id: 'pubTh', accountId: 'accTh', remoteRef: null, content: { ...baiAnh }, account: { ...bang.mktAccount.find(a => a.id === 'accTh') } })
    ;(globalThis as any).fetch = fetchCu
    kiem('worker gửi ĐÚNG media của phiên bản (có url)', kqTh === 'da-gui' && guiTh?.assets?.[0]?.url?.endsWith('/mkt/x.jpg'), guiTh)
    kiem('token Threads sắp hết được gia hạn TRƯỚC khi đăng và đăng bằng token mới', guiTh?.token === 'tokMoi', guiTh)
    const accTh = bang.mktAccount.find(a => a.id === 'accTh')
    kiem('token mới được lưu (mã hoá) + hạn mới ~60 ngày', accTh.accessToken !== 'tokMoi' && new Date(accTh.tokenExpiresAt).getTime() > Date.now() + 59 * 86400_000)

    console.log('━━ Xoá thương hiệu')
    bang.mktPublication.push({ id: 'pubCho', contentId: id, accountId: 'accB', status: 'queued', idempotencyKey: 'k2', scheduledAt: new Date() })
    const ban = await goi('DELETE', `/brands/${B}`, { brand: A })
    kiem('còn bài đang chờ → không xoá', ban.status === 409 && ban.code === 'BRAND_BUSY', ban)
    bang.mktPublication.find(p => p.id === 'pubCho').status = 'cancelled'
    const xoa = await goi('DELETE', `/brands/${B}`, { brand: A })
    kiem('xoá mềm thành công', xoa.success && !!bang.mktBrand.find(b => b.id === B).archivedAt, xoa)
    kiem('dữ liệu của thương hiệu đã xoá VẪN còn trong DB', bang.mktContent.some(c => c.brandId === B))
    kiem('thương hiệu đã xoá → 404', (await goi('GET', '/state', { brand: B })).status === 404)
    kiem('xoá xong thì thêm lại được (còn 9/10)', (await goi('POST', '/brands', { body: { name: 'Mới' } })).status === 201)
    for (const b of bang.mktBrand.filter(x => x.id !== A)) b.archivedAt = new Date()
    kiem('không xoá được thương hiệu cuối cùng', (await goi('DELETE', `/brands/${A}`)).status === 409)

    console.log(`\n━━ KẾT QUẢ: ${dat} đạt / ${truot} trượt ━━`)
    process.exit(truot ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
