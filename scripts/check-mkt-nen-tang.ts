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

/* Bài Threads THẬT AI lưu cho HUTI 30/09 (người đã duyệt): JS `.length` = 545, Threads đếm 549. */
const HUTI = `Nhiều khi lướt ảnh quẹt trái quẹt phải hoài cũng chán, vì ngoại hình đâu nói lên hai người có hợp tuổi, hợp nết hay không đúng không mấy ông mấy bà? 🙈

Tơ Hồng chọn cách kết nối khác biệt: chấm độ hợp nhau theo ngày sinh và tuổi can chi trước. Nhờ vậy, bạn biết ngay mức độ ăn ý về giao tiếp hay cảm xúc trước khi mở lời.

Tụi mình trò chuyện ẩn danh bằng mã số, khi cả hai sẵn sàng mới lộ diện. Dùng miễn phí trên web, link ở bio nha ✨

Mấy ông mấy bà tin vào độ hợp tuổi can chi hay tin vào ấn tượng đầu tiên qua ảnh hơn? (topic: 12 con giáp)`

async function main() {
    const { nenTangInstagram, nenTangThreads, nenTangTiktok, nenTangYoutube, kiemDinhDang, xacMinhKenh, giaHanToken, layChiSo, demKyTu, loiPhanChu } =
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
    hangCho = [{ id: 'thc3' }]
    await nhip(nenTangThreads, { externalId: 'th1' }, { body: 'Café 🙈', options: { topicTag: ' 12 con giáp ' }, assets: [] }, null, () => { })
    kiem('chủ đề đi qua tham số topic_tag (không nằm trong chữ), chữ gửi dạng NFC', daGoi.at(-1)!.body.topic_tag === '12 con giáp' && daGoi.at(-1)!.body.text === 'Café 🙈', daGoi.at(-1)!.body)
    hangCho = [{ id: 'thc4' }]
    await nhip(nenTangThreads, { externalId: 'th1' }, { body: 'x', options: {}, assets: [] }, null, () => { })
    kiem('không có chủ đề ⇒ không gửi topic_tag', !('topic_tag' in daGoi.at(-1)!.body), daGoi.at(-1)!.body)

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
    const soDem = [demKyTu('threads', 'Chào 🙈'), demKyTu('threads', '❤️'), demKyTu('threads', '🇻🇳'), demKyTu('threads', 'ệ')]
    kiem('đếm kiểu Threads: chữ Việt có dấu = 1 (kể cả dạng tổ hợp), emoji theo byte UTF-8', soDem.join() === '9,6,8,1', soDem)
    kiem('nền tảng khác giữ cách đếm cũ (.length)', demKyTu('instagram', 'Chào 🙈') === 7)
    const loiHuti = loiPhanChu('threads', { text: HUTI })
    kiem('bài HUTI 30/09 (JS đếm 545) ⇒ "549/500", phải cắt ít nhất 49', HUTI.length === 545 && loiHuti.length === 1 && /549\/500/.test(loiHuti[0]) && /ít nhất 49/.test(loiHuti[0]), loiHuti)
    const nhieuIcon = 'Mấy bà ơi '.repeat(46) + '✨🙈❤️🔥🎉'.repeat(3)
    kiem('bài nhiều emoji: JS đếm <500 (tưởng lọt) nhưng Threads >500 ⇒ vẫn chặn', nhieuIcon.length < 500 && kiemDinhDang('threads', { text: nhieuIcon }, []).some(e => /\/500/.test(e)), [nhieuIcon.length, demKyTu('threads', nhieuIcon)])
    const link = (n: number) => Array(n).fill('https://tohong.kengi.vn/x').join(' ')
    kiem('Threads > 5 liên kết bị chặn, đúng 5 thì qua', loiPhanChu('threads', { text: link(6) }).some(e => /5 liên kết/.test(e)) && loiPhanChu('threads', { text: link(5) }).length === 0)
    kiem('topicTag có dấu chấm / dấu & / quá 50 ký tự bị chặn', ['a.b', 'A & B', 'x'.repeat(51)].every(t => loiPhanChu('threads', { text: 'ok', options: { topicTag: t } }).length === 1))
    kiem('topicTag hợp lệ hoặc bỏ trống thì qua', loiPhanChu('threads', { text: 'ok', options: { topicTag: '12 con giáp' } }).length === 0 && loiPhanChu('threads', { text: 'ok', options: { topicTag: '' } }).length === 0)
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
    kiem('chỉ ĐÚNG MỘT tool duyệt (mkt_duyet_noi_dung, bị công tắc từng thương hiệu chặn)', MKT_TOOLS.filter(t => /duyet|approve/i.test(t.name)).map(t => t.name).join() === 'mkt_duyet_noi_dung')
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
    kiem('báo rõ hồ sơ còn thiếu gì (không bịa phần thiếu)', hs.conThieu.includes('sản phẩm / dịch vụ') && hs.conThieu.includes('giọng văn / quy tắc viết') && /không bịa/.test(hs.huongDan), hs)

    // Đúng hồ sơ HUTI 30/09: voice TRỐNG, quy tắc (kể cả icon + xưng hô) nằm ở notes
    ;(b1 as any).voice = ''
    ;(b1 as any).notes = 'Lưu ý khi viết bài:\n- Không gắn link trong thân bài; ghi "link ở bio".\nThêm các icon cho tự nhiên, xưng hô tự nhiên mấy bà, mấy ông'
    const hsHuti: any = await tool('mkt_ho_so_thuong_hieu').run({ thuongHieu: 'b1' }, ctx)
    kiem('ghi chú cho AI (notes) được đưa vào quyTacViet', /Thêm các icon cho tự nhiên/.test(hsHuti.quyTacViet) && /link ở bio/.test(hsHuti.quyTacViet), hsHuti.quyTacViet)
    kiem('quy tắc viết là BẮT BUỘC (không còn câu "không phải lệnh cho AI")', /BẮT BUỘC làm theo từng dòng/.test(hsHuti.huongDan) && !/không phải lệnh/.test(hsHuti.huongDan), hsHuti.huongDan)
    kiem('voice trống nhưng notes có giọng văn ⇒ KHÔNG báo "thiếu giọng văn / viết chung chung"', !hsHuti.conThieu.some((x: string) => /giọng văn/.test(x)) && !/chung chung/.test(hsHuti.huongDan), hsHuti.conThieu)
    kiem('từ cấm cũng nằm trong quy tắc viết', /Từ cấm.*rẻ nhất/.test(hsHuti.quyTacViet), hsHuti.quyTacViet)
    kiem('mô tả tool nói rõ quyTacViet phải làm theo (icon, xưng hô)', /quyTacViet/.test(tool('mkt_ho_so_thuong_hieu').description) && /icon/.test(tool('mkt_ho_so_thuong_hieu').description))
    let loiCheo: any = null
    try { await tool('mkt_soan_noi_dung').run({ thuongHieu: 'b1', noiDung: 'x', phienBan: [{ kenhId: 'a2', noiDung: 'y' }] }, ctx) } catch (e) { loiCheo = e }
    kiem('AI không gắn được kênh của thương hiệu khác', /không thuộc thương hiệu/.test(loiCheo?.message), loiCheo?.message)
    const soan: any = await tool('mkt_soan_noi_dung').run({ thuongHieu: 'b1', tieuDe: 'Mẹo', phienBan: [{ kenhId: 'a1', noiDung: 'Chảo gang rẻ nhất phố' }] }, ctx)
    kiem('bài AI vào CHỜ DUYỆT, gắn đúng thương hiệu, nguồn ai', soan.trangThai === 'pending' && dl.mktContent[0].brandId === 'b1' && dl.mktContent[0].source === 'ai', soan)
    kiem('cảnh báo từ cấm ngay lúc soạn', /rẻ nhất/.test(soan.canhBaoTuCam || ''), soan)
    kiem('sau MỖI bài lưu, nhắc AI đối chiếu với quy tắc viết (icon, xưng hô…)', /Đối chiếu/.test(soan.doiChieu || '') && /Thêm các icon/.test(soan.doiChieu || ''), soan.doiChieu)
    let loiLich: any = null
    try { await tool('mkt_len_lich_dang').run({ thuongHieu: 'b1', noiDungId: soan.id }, ctx) } catch (e) { loiLich = e }
    kiem('chưa duyệt ⇒ AI không lên lịch được', /chưa được duyệt/.test(loiLich?.message), loiLich?.message)
    dl.mktContent[0].approvedRevision = 1
    const lich: any = await tool('mkt_len_lich_dang').run({ thuongHieu: 'b1', noiDungId: soan.id }, ctx)
    kiem('đã duyệt nhưng có từ cấm ⇒ kênh bị bỏ qua kèm lý do', lich.daLenLich === 0 && /từ cấm/.test(lich.boQua.join(' ')), lich)
    const cn: any = await tool('mkt_cap_nhat_ho_so_thuong_hieu').run({ thuongHieu: 'b2', products: 'Trà sữa – 35.000đ' }, ctx)
    kiem('cập nhật hồ sơ từng phần', cn.daCapNhat.join() === 'products' && cn.hoSo.products === 'Trà sữa – 35.000đ', cn)

    console.log('━━ AI tự duyệt (công tắc từng thương hiệu)')
    const { TOOL_NHAY_CAM } = await import('../src/services/aiAgentRunner')
    kiem('mkt_duyet_noi_dung là tool ghi + nhạy cảm (tác vụ tự động phải gọi đích danh)', tool('mkt_duyet_noi_dung').write === true && TOOL_NHAY_CAM.has('mkt_duyet_noi_dung'))
    let loiTuCap: any = null
    try { await tool('mkt_cap_nhat_ho_so_thuong_hieu').run({ thuongHieu: 'b1', aiAutoApprove: true }, ctx) } catch (e) { loiTuCap = e }
    kiem('AI KHÔNG tự bật được công tắc qua tool sửa hồ sơ', !!loiTuCap && b1.hasOwnProperty('aiAutoApprove') === false, loiTuCap?.message)
    const baiSach: any = await tool('mkt_soan_noi_dung').run({ thuongHieu: 'b1', tieuDe: 'Mẹo', phienBan: [{ kenhId: 'a1', noiDung: 'Tráng dầu mỏng rồi đun 10 phút là chảo gang dùng cả đời.' }] }, ctx)
    let loiTat: any = null
    try { await tool('mkt_duyet_noi_dung').run({ thuongHieu: 'b1', noiDungId: baiSach.id }, ctx) } catch (e) { loiTat = e }
    kiem('công tắc TẮT ⇒ AI không duyệt được, bài vẫn chờ người', /CHƯA bật/.test(loiTat?.message) && dl.mktContent.find((c: any) => c.id === baiSach.id).approvedRevision === null, loiTat?.message)
    ;(b1 as any).aiAutoApprove = true
    let loiCam: any = null
    try { await tool('mkt_duyet_noi_dung').run({ thuongHieu: 'b1', noiDungId: soan.id }, ctx) } catch (e) { loiCam = e }
    kiem('công tắc BẬT nhưng bài có từ cấm ⇒ KHÔNG duyệt', /từ cấm/.test(loiCam?.message), loiCam?.message)
    const tuDuyet: any = await tool('mkt_duyet_noi_dung').run({ thuongHieu: 'b1', noiDungId: baiSach.id, henLuc: '2026-10-01T08:00' }, ctx)
    const daDuyet = dl.mktContent.find((c: any) => c.id === baiSach.id)
    kiem('công tắc BẬT + bài sạch ⇒ duyệt, ghi dấu "ai:tu-duyet"', tuDuyet.daDuyet && daDuyet.approvedBy === 'ai:tu-duyet' && daDuyet.approvedRevision === daDuyet.revision, tuDuyet)
    const luot = dl.mktPublication.find((x: any) => x.contentId === baiSach.id)
    kiem('henLuc không kèm múi giờ hiểu là GIỜ VN (08:00 VN = 01:00Z)', luot?.scheduledAt?.toISOString() === '2026-10-01T01:00:00.000Z', luot?.scheduledAt)
    const biTuChoi: any = await tool('mkt_soan_noi_dung').run({ thuongHieu: 'b1', phienBan: [{ kenhId: 'a1', noiDung: 'Bài khác' }] }, ctx)
    dl.mktContent.find((c: any) => c.id === biTuChoi.id).status = 'rejected'
    let loiLat: any = null
    try { await tool('mkt_duyet_noi_dung').run({ thuongHieu: 'b1', noiDungId: biTuChoi.id }, ctx) } catch (e) { loiLat = e }
    kiem('bài NGƯỜI đã từ chối ⇒ AI không lật lại được', /TỪ CHỐI/.test(loiLat?.message), loiLat?.message)

    console.log('━━ Giới hạn chữ: chặn NGAY lúc AI lưu (HUTI 30/09 lưu được bài Threads 545 ký tự)')
    const truoc = dl.mktContent.length
    const loiSoan = async (args: any) => { try { await tool('mkt_soan_noi_dung').run({ thuongHieu: 'b1', ...args }, ctx); return null } catch (e: any) { return e?.message || String(e) } }
    const lDai = await loiSoan({ tieuDe: 'Can chi', phienBan: [{ kenhId: 'a1', noiDung: HUTI }] })
    kiem('bài Threads 549/500 ⇒ "CHƯA LƯU" + đúng số ký tự + số phải cắt', /CHƯA LƯU/.test(lDai || '') && /549\/500/.test(lDai || '') && /ít nhất 49/.test(lDai || ''), lDai)
    kiem('…và nói rõ gọi lại KHÔNG thành bài trùng', /KHÔNG thành bài trùng/.test(lDai || ''), lDai)
    kiem('…và thật sự không có bài nào được lưu', dl.mktContent.length === truoc, dl.mktContent.length - truoc)
    const lIcon = await loiSoan({ phienBan: [{ kenhId: 'a1', noiDung: nhieuIcon }] })
    kiem('bài nhiều emoji (JS đếm <500) vẫn bị chặn', /CHƯA LƯU/.test(lIcon || ''), lIcon)
    const lThan = await loiSoan({ noiDung: HUTI, phienBan: [{ kenhId: 'a1', noiDung: '' }] })
    kiem('phiên bản Threads để trống ⇒ kiểm THÂN CHUNG (thứ sẽ được đăng)', /CHƯA LƯU/.test(lThan || ''), lThan)
    const lTopic = await loiSoan({ phienBan: [{ kenhId: 'a1', noiDung: 'Mấy bà tin can chi không? (topic: 12 con giáp)' }] })
    kiem('ghi "(topic: …)" vào nội dung ⇒ chặn, chỉ sang tuyChon.topicTag', /topicTag/.test(lTopic || ''), lTopic)
    const lTag = await loiSoan({ phienBan: [{ kenhId: 'a1', noiDung: 'Ngắn thôi', tuyChon: { topicTag: 'Can & chi' } }] })
    kiem('topicTag có dấu & ⇒ chặn', /topicTag/.test(lTag || ''), lTag)
    kiem('không lưu bài nào trong các lần bị chặn', dl.mktContent.length === truoc, dl.mktContent.length - truoc)
    const dung: any = await tool('mkt_soan_noi_dung').run({ thuongHieu: 'b1', phienBan: [{ kenhId: 'a1', noiDung: 'Mấy bà tin tuổi can chi hay tin ảnh hơn? 🙈', tuyChon: { topicTag: '12 con giáp' } }] }, ctx)
    const luu = dl.mktContent.find((c: any) => c.id === dung.id)
    kiem('bài đúng giới hạn + chủ đề ⇒ lưu, chủ đề nằm trong tuỳ chọn phiên bản', JSON.parse(luu?.variants || '[]')[0]?.options?.topicTag === '12 con giáp', luu?.variants)
    kiem('thương hiệu BẬT tự duyệt ⇒ ghi chú chỉ đường mkt_duyet_noi_dung, không nói "AI không có quyền duyệt"', /mkt_duyet_noi_dung/.test(dung.ghiChu) && !/không có quyền duyệt/.test(dung.ghiChu), dung.ghiChu)
    kiem('mô tả tool nói rõ cách Threads đếm emoji + máy chủ từ chối lưu', /EMOJI/.test(tool('mkt_soan_noi_dung').description) && /TỪ CHỐI LƯU/.test(tool('mkt_soan_noi_dung').description))

    console.log('━━ Giờ hẹn (gioVN)')
    const { gioVN } = await import('../src/lib/mktNoiDung')
    const iso = (s: string) => { const d = gioVN(s); return isNaN(+d) ? 'Invalid Date' : d.toISOString() }
    kiem('không kèm múi giờ ⇒ giờ VN', iso('2026-10-01T08:00') === '2026-10-01T01:00:00.000Z', iso('2026-10-01T08:00'))
    kiem('có sẵn +07:00 (đúng dạng máy chủ đưa cho AI) ⇒ đúng giờ, KHÔNG Invalid Date', iso('2026-10-01T08:00:00+07:00') === '2026-10-01T01:00:00.000Z', iso('2026-10-01T08:00:00+07:00'))
    kiem('+0700 (không dấu hai chấm) ⇒ đúng giờ', iso('2026-10-01T08:00:00.000+0700') === '2026-10-01T01:00:00.000Z', iso('2026-10-01T08:00:00.000+0700'))
    kiem('có Z ⇒ giữ nguyên', iso('2026-10-01T01:00:00Z') === '2026-10-01T01:00:00.000Z')
    kiem('dấu cách thay chữ T ⇒ vẫn là giờ VN (trước đây bị hiểu là UTC, lệch 7 tiếng)', iso('2026-10-01 08:00') === '2026-10-01T01:00:00.000Z', iso('2026-10-01 08:00'))

    console.log(`\n━━ KẾT QUẢ: ${dat} đạt / ${truot} trượt ━━`)
    process.exit(truot ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
