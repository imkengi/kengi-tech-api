/**
 * KIỂM BỘ ĐĂNG NHIỀU NỀN TẢNG + TOOL MCP MARKETING  —  npm run check:mkt (phần 2)
 *
 * `fetch` bị thay bằng bản GIẢ ghi lại từng lời gọi — không lời nào ra mạng thật.
 * DB là prisma giả trong bộ nhớ; DATABASE_URL trỏ cổng chết (máy dev .env = PROD).
 */
process.env.DATABASE_URL = 'postgresql://khong:khong@127.0.0.1:1/khong-bao-gio'
process.env.DIRECT_URL = process.env.DATABASE_URL
process.env.MARKETING_VAULT_KEY = 'b'.repeat(64)

type GoiGia = { url: string; method: string; body: any; headers: any }
let hangCho: any[] = []
const daGoi: GoiGia[] = []
;(globalThis as any).fetch = async (url: string, opt: any = {}) => {
    const body = opt.body === undefined ? null
        : Buffer.isBuffer(opt.body) ? `<${opt.body.length} byte>`
            : typeof opt.body === 'string' ? (() => { try { return JSON.parse(opt.body) } catch { return opt.body } })()
                : String(opt.body)
    daGoi.push({ url: String(url), method: opt.method || 'GET', body, headers: opt.headers || {} })
    const tl = hangCho.shift()
    if (tl === undefined) throw new Error('fetch giả hết câu trả lời cho ' + url)
    if (tl instanceof Error) throw tl
    return new Response(tl.raw ?? JSON.stringify(tl.body ?? tl), {
        status: tl.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(tl.headers || {}) },
    })
}

let dat = 0, truot = 0
function kiem(ten: string, dung: boolean, chiTiet?: any) {
    if (dung) { dat++; console.log('  ✅', ten) }
    else { truot++; console.log('  ❌', ten, chiTiet !== undefined ? JSON.stringify(chiTiet).slice(0, 400) : '') }
}
/** Chạy một nhịp đăng; nhịp "đang xử lý" ném LoiNenTang thuLaiDuoc — trả về lỗi đó. */
async function nhip(nt: any, tk: any, bai: any, moc: string | null, luu: (m: string) => void) {
    try { return { kq: await nt.dang(tk, 'TOKEN_GIA', bai, moc, async (m: string) => luu(m)) } }
    catch (e: any) { return { loi: e } }
}

async function main() {
    const { nenTangInstagram, nenTangThreads, nenTangTiktok, nenTangYoutube, kiemDinhDang, xacMinhKenh, giaHanToken, layChiSo } =
        await import('../src/services/mktNenTangKhac')

    console.log('━━ Instagram: container → chờ FINISHED → publish')
    let moc: string | null = null
    hangCho = [{ id: 'cont1' }]
    let r: any = await nhip(nenTangInstagram, { externalId: 'ig1' }, { body: 'Cap', assets: [{ type: 'video', url: 'https://cdn.x/v.mp4' }] }, null, m => (moc = m))
    kiem('nhịp 1 tạo container REELS và GHI MỐC trước khi đi tiếp', moc === 'cont1' && daGoi.at(-1)!.body.media_type === 'REELS' && r.loi?.thuLaiDuoc, r.loi?.message)
    hangCho = [{ status_code: 'IN_PROGRESS' }]
    r = await nhip(nenTangInstagram, { externalId: 'ig1' }, { body: 'Cap', assets: [] }, moc, () => { })
    kiem('chưa FINISHED ⇒ chờ, không publish', r.loi?.thuLaiDuoc && daGoi.length === 2)
    hangCho = [{ status_code: 'FINISHED' }, { id: 'igpost' }]
    r = await nhip(nenTangInstagram, { externalId: 'ig1' }, { body: 'Cap', assets: [] }, moc, () => { })
    kiem('FINISHED ⇒ media_publish đúng creation_id', r.kq?.remotePostId === 'igpost' && daGoi.at(-1)!.body.creation_id === 'cont1', r)
    hangCho = [{ status_code: 'PUBLISHED' }]
    r = await nhip(nenTangInstagram, { externalId: 'ig1' }, { body: 'Cap', assets: [] }, 'cont1', () => { })
    kiem('container đã PUBLISHED mà mình chưa có id ⇒ MƠ HỒ, không đăng lại', r.loi?.moHo === true, r.loi)

    console.log('━━ Threads: token ở URL, TEXT/IMAGE/VIDEO')
    moc = null
    hangCho = [{ id: 'thc1' }]
    r = await nhip(nenTangThreads, { externalId: 'th1' }, { body: 'Chào', assets: [] }, null, m => (moc = m))
    const g = daGoi.at(-1)!
    kiem('bài chữ ⇒ media_type TEXT, token ở tham số URL', g.body.media_type === 'TEXT' && g.url.includes('access_token=TOKEN_GIA') && !g.headers.Authorization, g)
    hangCho = [{ body: { status: 'FINISHED' } }, { id: 'thpost' }]
    r = await nhip(nenTangThreads, { externalId: 'th1' }, { body: 'Chào', assets: [] }, moc, () => { })
    kiem('publish trả đúng id', r.kq?.remotePostId === 'thpost', r)
    hangCho = [{ id: 'thc2' }]
    await nhip(nenTangThreads, { externalId: 'th1' }, { body: 'x', assets: [{ type: 'image', url: 'https://cdn.x/a.png' }] }, null, () => { })
    kiem('ảnh ⇒ IMAGE + image_url', daGoi.at(-1)!.body.media_type === 'IMAGE' && daGoi.at(-1)!.body.image_url === 'https://cdn.x/a.png')

    console.log('━━ TikTok: FILE_UPLOAD, privacy theo tài khoản, publish_id ≠ id công khai')
    moc = null
    const video = Buffer.alloc(1234, 1)
    hangCho = [
        { raw: '', headers: { 'content-length': '1234' } },                                   // HEAD video
        { data: { privacy_level_options: ['SELF_ONLY'], comment_disabled: true } },          // creator info
        { data: { publish_id: 'pub1', upload_url: 'https://open-upload.tiktokapis.com/u/1' }, error: { code: 'ok' } },
        { raw: video },                                                                       // GET video
        { raw: '', status: 201 },                                                             // PUT khúc
    ]
    const tt = { privacy: 'SELF_ONLY', disableComment: false, tiktokConsent: true, aiGenerated: true }
    const mocTT: string[] = []
    r = await nhip(nenTangTiktok, { externalId: 'op1' }, { body: 'Clip', options: tt, assets: [{ type: 'video', url: 'https://cdn.x/v.mp4' }] }, null, m => mocTT.push(m))
    const init = daGoi.find(x => x.url.includes('/video/init/'))!
    kiem('init FILE_UPLOAD đúng kích thước, tắt bình luận theo tài khoản', init.body.source_info.source === 'FILE_UPLOAD' && init.body.source_info.video_size === 1234 && init.body.post_info.disable_comment === true, init.body)
    kiem('ghi mốc tt-up (trước khi tải) rồi tt-pub (sau khi tải)', mocTT[0]?.startsWith('tt-up:pub1|') && mocTT[1] === 'tt-pub:pub1', mocTT)
    const put = daGoi.find(x => x.method === 'PUT')!
    kiem('PUT khúc có Content-Range đủ file', put.headers['Content-Range'] === 'bytes 0-1233/1234', put.headers)
    hangCho = [{ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [] }, error: { code: 'ok' } }]
    r = await nhip(nenTangTiktok, { externalId: 'op1' }, { body: 'Clip', options: tt, assets: [] }, 'tt-pub:pub1', () => { })
    kiem('xong mà chưa có id công khai ⇒ ghi "publish:<id>", không bịa id bài', r.kq?.remotePostId === 'publish:pub1', r)
    hangCho = [{ raw: '', headers: { 'content-length': '1234' } }, { data: { privacy_level_options: ['SELF_ONLY'] } }]
    r = await nhip(nenTangTiktok, { externalId: 'op1' }, { body: 'x', options: { ...tt, privacy: 'PUBLIC_TO_EVERYONE' }, assets: [{ type: 'video', url: 'https://cdn.x/v.mp4' }] }, null, () => { })
    kiem('quyền riêng tư tài khoản không cho ⇒ từ chối TRƯỚC khi init', r.loi?.code === 'TIKTOK_PRIVACY' && !r.loi?.moHo, r.loi)

    console.log('━━ YouTube: resumable, tiếp từ byte đã nhận, chờ processed')
    const up = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc'
    const vid = Buffer.from('0000ftypTEST_VIDEO')
    const mocYT: string[] = []
    hangCho = [
        { raw: '', headers: { 'content-length': String(vid.length) } },
        { raw: '', status: 200, headers: { location: up } },
        { raw: '', status: 308, headers: { range: 'bytes=0-3' } },
        { raw: vid.subarray(4) },
        { body: { id: 'ytv', status: { privacyStatus: 'private' } } },
    ]
    r = await nhip(nenTangYoutube, { externalId: 'UC1' }, { body: 'Mô tả', title: 'Tiêu đề', options: { privacy: 'public', madeForKids: false }, assets: [{ type: 'video', url: 'https://cdn.x/v.mp4' }] }, null, m => mocYT.push(m))
    const tiep = daGoi.filter(x => x.method === 'PUT').at(-1)!
    kiem('tải TIẾP từ byte 4 (không tải lại từ đầu)', tiep.headers['Content-Range'] === `bytes 4-${vid.length - 1}/${vid.length}`, tiep.headers)
    kiem('mốc: yt-up rồi yt-vid', mocYT[0] === `yt-up:${up}` && mocYT[1] === 'yt-vid:ytv', mocYT)
    hangCho = [{ items: [{ status: { uploadStatus: 'processed', privacyStatus: 'private' } }] }]
    r = await nhip(nenTangYoutube, { externalId: 'UC1' }, { body: '', assets: [] }, 'yt-vid:ytv', () => { })
    kiem('processed ⇒ xong', r.kq?.remotePostId === 'ytv', r)

    console.log('━━ Kiểm định dạng theo nền tảng')
    kiem('Threads > 500 ký tự bị chặn', kiemDinhDang('threads', { text: 'x'.repeat(501) }, []).some(e => e.includes('500')))
    kiem('Threads chữ thuần hợp lệ', kiemDinhDang('threads', { text: 'Chào' }, []).length === 0)
    kiem('Instagram không media bị chặn', kiemDinhDang('instagram', { text: 'x' }, []).length > 0)
    kiem('Instagram PNG bị chặn', kiemDinhDang('instagram', { text: 'x' }, [{ type: 'image', url: 'https://a/b.png', mime: 'image/png' }]).some(e => e.includes('JPEG')))
    const yt = kiemDinhDang('youtube', { text: 'x', title: '' }, [{ type: 'video', url: 'https://a/v.mp4' }])
    kiem('YouTube thiếu tiêu đề / quyền riêng tư / trẻ em', yt.length >= 3, yt)
    kiem('TikTok thiếu đồng ý của chủ kênh bị chặn', kiemDinhDang('tiktok', { text: 'x', options: { privacy: 'SELF_ONLY' } }, [{ type: 'video', url: 'https://a/v.mp4' }]).some(e => e.includes('đồng ý')))

    console.log('━━ Xác minh / gia hạn / số liệu')
    hangCho = [{ id: 'th9', username: 'bep' }]
    const xm = await xacMinhKenh('threads', 'T', undefined)
    kiem('xác minh Threads lấy id + tên', xm.externalId === 'th9' && xm.name === 'bep')
    hangCho = [{ id: 'khac' }]
    let loiXm: any = null
    try { await xacMinhKenh('threads', 'T', 'th9') } catch (e) { loiXm = e }
    kiem('token của tài khoản KHÁC ⇒ từ chối', loiXm?.code === 'SAI_TAI_KHOAN', loiXm?.message)
    hangCho = [{ instagram_business_account: { id: 'ig7' } }, { id: 'ig7', username: 'shop' }]
    const ig = await xacMinhKenh('instagram', 'T')
    kiem('Instagram không khai ID ⇒ tự tìm tài khoản gắn Page', ig.externalId === 'ig7', ig)
    hangCho = [{ access_token: 'MOI', expires_in: 5184000 }]
    const gh = await giaHanToken('threads', 'CU')
    kiem('gia hạn Threads không cần client secret, hạn ~60 ngày', gh.accessToken === 'MOI' && gh.hetHan.getTime() > Date.now() + 59 * 86400_000 && daGoi.at(-1)!.url.includes('th_refresh_token'))
    let loiGh: any = null
    try { await giaHanToken('youtube', 'CU', null) } catch (e) { loiGh = e }
    kiem('YouTube không có refresh token ⇒ báo rõ, không gọi mạng', loiGh?.code === 'THIEU_LAM_MOI')
    hangCho = [{ data: [{ name: 'views', values: [{ value: 120 }] }, { name: 'likes', values: [{ value: 9 }] }, { name: 'replies', values: [{ value: 3 }] }, { name: 'reposts', values: [{ value: 2 }] }, { name: 'quotes', values: [{ value: 1 }] }] }]
    const cs = await layChiSo('threads', 'T', 'p1')
    kiem('số liệu Threads: chia sẻ = repost + quote', JSON.stringify(cs) === JSON.stringify({ views: 120, likes: 9, comments: 3, shares: 3 }), cs)
    hangCho = [{ data: [] }]
    const rong = await layChiSo('threads', 'T', 'p1')
    kiem('không có số ⇒ null, KHÔNG phải 0', rong.views === null && rong.shares === null, rong)

    // ─── MCP ────────────────────────────────────────────────────────────────
    console.log('━━ Tool MCP marketing')
    const { MKT_TOOLS } = await import('../src/routes/mcpMktTools')
    const { registryPrisma } = await import('../src/lib/prisma')
    ;(registryPrisma as any).store = { updateMany: async () => ({ count: 1 }) }
    const tool = (n: string) => MKT_TOOLS.find(t => t.name === n)!
    kiem('KHÔNG có tool duyệt bài', !MKT_TOOLS.some(t => /duyet|approve/i.test(t.name)))
    for (const n of ['mkt_soan_noi_dung', 'mkt_len_lich_dang', 'mkt_cap_nhat_ho_so_thuong_hieu'])
        kiem(`${n} đánh dấu write (key chỉ-đọc không gọi được)`, tool(n).write === true)
    kiem('tool đọc KHÔNG đánh dấu write', !tool('mkt_ho_so_thuong_hieu').write && !tool('mkt_danh_sach_kenh').write)

    const b1 = { id: 'b1', name: 'Bếp Nhà Mình', products: 'Chảo gang – 450.000đ', description: 'Đồ gang thủ công', bannedWords: '["rẻ nhất"]', archivedAt: null, createdAt: new Date(1) }
    const b2 = { id: 'b2', name: 'Trà Sữa Mây', products: '', description: '', bannedWords: '[]', archivedAt: null, createdAt: new Date(2) }
    const dl: any = { mktBrand: [b1, b2], mktAccount: [{ id: 'a1', brandId: 'b1', platform: 'threads', name: 'Threads bếp', status: 'active' }, { id: 'a2', brandId: 'b2', platform: 'facebook', name: 'Page Mây', status: 'active' }], mktContent: [], mktPublication: [], mktAsset: [], mktCampaign: [] }
    const khop = (d: any, w: any = {}) => Object.entries(w).every(([k, v]: any) => v && typeof v === 'object' && !(v instanceof Date) ? ('in' in v ? v.in.includes(d[k]) : true) : v === null ? d[k] == null : d[k] === v)
    const gia: any = new Proxy({}, {
        get: (_t, m: string) => ({
            findMany: async ({ where }: any = {}) => (dl[m] || []).filter((d: any) => khop(d, where)),
            findFirst: async ({ where }: any = {}) => (dl[m] || []).find((d: any) => khop(d, where)) || null,
            findUnique: async ({ where }: any) => (dl[m] || []).find((d: any) => khop(d, where)) || null,
            count: async ({ where }: any = {}) => (dl[m] || []).filter((d: any) => khop(d, where)).length,
            create: async ({ data }: any) => { const d = { id: m + (dl[m].length + 1), revision: 1, approvedRevision: null, ...data }; dl[m].push(d); return d },
            update: async ({ where, data }: any) => { const d = dl[m].find((x: any) => khop(x, where)); Object.assign(d, data); return d },
            updateMany: async () => ({ count: 0 }),
        }),
    })
    const ctx: any = { prisma: gia, scopes: 'read write', storeCode: 'TEST' }
    let loiTH: any = null
    try { await tool('mkt_ho_so_thuong_hieu').run({}, ctx) } catch (e) { loiTH = e }
    kiem('>1 thương hiệu mà không nói rõ ⇒ từ chối + liệt kê, KHÔNG đoán', /2 thương hiệu/.test(loiTH?.message) && /Trà Sữa Mây/.test(loiTH?.message), loiTH?.message)
    const hs: any = await tool('mkt_ho_so_thuong_hieu').run({ thuongHieu: 'trà sữa mây' }, ctx)
    kiem('chọn theo TÊN (không phân biệt hoa thường)', hs.hoSo.name === 'Trà Sữa Mây')
    kiem('báo rõ hồ sơ còn thiếu gì', hs.conThieu.includes('sản phẩm / dịch vụ') && /đừng đoán/.test(hs.huongDan), hs)
    let loiCheo: any = null
    try { await tool('mkt_soan_noi_dung').run({ thuongHieu: 'b1', noiDung: 'x', phienBan: [{ kenhId: 'a2', noiDung: 'y' }] }, ctx) } catch (e) { loiCheo = e }
    kiem('AI không gắn được kênh của thương hiệu khác', /không thuộc thương hiệu/.test(loiCheo?.message), loiCheo?.message)
    const soan: any = await tool('mkt_soan_noi_dung').run({ thuongHieu: 'b1', tieuDe: 'Mẹo', phienBan: [{ kenhId: 'a1', noiDung: 'Chảo gang rẻ nhất phố' }] }, ctx)
    kiem('bài AI vào CHỜ DUYỆT, gắn đúng thương hiệu, nguồn ai', soan.trangThai === 'pending' && dl.mktContent[0].brandId === 'b1' && dl.mktContent[0].source === 'ai', soan)
    kiem('cảnh báo từ cấm ngay lúc soạn', /rẻ nhất/.test(soan.canhBaoTuCam || ''), soan)
    let loiLich: any = null
    try { await tool('mkt_len_lich_dang').run({ thuongHieu: 'b1', noiDungId: soan.id }, ctx) } catch (e) { loiLich = e }
    kiem('chưa duyệt ⇒ AI không lên lịch được', /chưa được duyệt/.test(loiLich?.message), loiLich?.message)
    dl.mktContent[0].approvedRevision = 1
    const lich: any = await tool('mkt_len_lich_dang').run({ thuongHieu: 'b1', noiDungId: soan.id }, ctx)
    kiem('đã duyệt nhưng có từ cấm ⇒ kênh bị bỏ qua kèm lý do', lich.daLenLich === 0 && /từ cấm/.test(lich.boQua.join(' ')), lich)
    const cn: any = await tool('mkt_cap_nhat_ho_so_thuong_hieu').run({ thuongHieu: 'b2', products: 'Trà sữa – 35.000đ' }, ctx)
    kiem('cập nhật hồ sơ từng phần', cn.daCapNhat.join() === 'products' && cn.hoSo.products === 'Trà sữa – 35.000đ', cn)

    console.log(`\n━━ KẾT QUẢ: ${dat} đạt / ${truot} trượt ━━`)
    process.exit(truot ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
