/**
 * Kiểm CHAT SHOPEE — npx tsx scripts/check-shopee-chat.ts
 *
 * Vì sao có bộ này (24/10/2026): suốt nhiều tháng khung chat Shopee của các gian lâu năm chỉ hiện hội thoại
 * CŨ, tưởng do Shopee chưa mở "chat v2" (đã gửi ticket nhầm hướng 15/10). Thật ra get_conversation_list
 * được gọi trang đầu bằng direction=latest KHÔNG kèm mốc — tài liệu: mốc bỏ trống = vô cực, 'latest' là
 * dữ liệu SAU mốc — Shopee trả hội thoại cũ nhất của gian. Đúng là 'older' + mốc vô cực, lùi bằng
 * next_cursor.next_message_time_nano. Bộ này giữ:
 *   A. getConversationList — mọi trang 'older'; trang đầu KHÔNG mốc; trang sau mốc = cursor; mặc định 1 trang;
 *      trả hasMore/nextOffset thật (không còn "đã lấy hết" giả); bắt đầu từ cursor được.
 *   B. lib/tinHieuChat.ts — ghi tín hiệu (không nội dung), tạo bảng lười một lần, thiếu bảng ⇒ rỗng.
 *   C. Bên gửi (24/10/2026: mọi tin hiện bên khách vì so from_id — mã TÀI KHOẢN — với shopId): tin của gian theo
 *      from_shop_id; tin tự động trả lời gắn cờ; get_message KHÔNG ghi nội dung tin ra log.
 *   D. Gợi ý trả lời bằng chatbot (nhân viên tự bấm gửi): câu cần trả lời = tin khách SAU lần cuối NGƯỜI của gian trả lời
 *      (tin tự động / Shopee gửi thay không tính); lịch sử xen kẽ khách–shop, mở đầu bằng khách; thẻ sản phẩm ra TÊN hàng;
 *      kho kiến thức chọn đúng gian; luật nháp Shopee cấm kéo khách ra ngoài sàn.
 */
process.env.SHOPEE_FORWARD_PROXY = ''   // không bao giờ ra mạng: httpGet bị thay bằng bản giả

import { ShopeeService, laTinCuaGian, laTinTuDong, tachCauHoiShopee, chuTinShopee, TinShopeeGoiY } from '../src/services/platforms/shopee'
import { chonShopChoKenh, LUAT_NHAP_SAN, loiAiChoNguoiDung } from '../src/routes/chatbot'
import { LoiGeminiTamThoi, LoiGeminiHetTien } from '../src/services/aiAgentRunner'
import { ghiTinHieuChat, docTinHieuChat } from '../src/lib/tinHieuChat'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

/** ShopeeService với httpGet giả: ghi lại URL, trả lần lượt các trang dựng sẵn. */
class ShopeeGia extends ShopeeService {
    url: string[] = []
    constructor(private trang: any[]) {
        super({ apiKey: '1000001', apiSecret: 'khoa-thu', accessToken: 'token-thu', refreshToken: 'r', shopId: '42' } as any)
    }
    protected async httpGet(url: string): Promise<any> {
        this.url.push(url)
        return this.trang.shift() ?? { error: '', response: { conversations: [], page_result: { more: false } } }
    }
}
const hoiThoai = (id: string, nano: string) => ({ conversation_id: id, to_id: 7, to_name: 'khach', last_message_timestamp: Number(nano), latest_message_type: 'text', latest_message_content: { text: 'x' }, unread_count: 0 })
const trang = (ds: any[], more: boolean, cursor?: string) => ({ error: '', response: { conversations: ds, page_result: { page_size: ds.length, more, next_cursor: { next_message_time_nano: cursor || '' } } } })
const thamSo = (u: string) => new URL(u).searchParams

async function main() {
    console.log('— A. get_conversation_list —')
    const s1 = new ShopeeGia([trang([hoiThoai('c1', '1761270000000000000'), hoiThoai('c2', '1761260000000000000')], true, '1761260000000000000')])
    const k1 = await s1.getConversationList({ pageSize: 60 })
    const p1 = thamSo(s1.url[0]!)
    ok('1. trang đầu direction=older (KHÔNG phải latest — latest không mốc trả hội thoại cũ nhất)', p1.get('direction') === 'older', p1.get('direction'))
    ok('2. trang đầu KHÔNG gửi next_timestamp_nano (mốc vô cực = từ mới nhất lùi về)', !p1.has('next_timestamp_nano'))
    ok('3. mặc định MỘT lượt gọi Shopee (không tự lật 10 trang mỗi lần web hỏi)', s1.url.length === 1, s1.url.length)
    ok('4. còn trang ⇒ hasMore=true + nextOffset = next_message_time_nano', k1.hasMore === true && k1.nextOffset === '1761260000000000000', { hasMore: k1.hasMore, nextOffset: k1.nextOffset })
    ok('5. page_size ≤ 60 (Shopee báo lỗi khi lớn hơn)', Number(thamSo(s1.url[0]!).get('page_size')) === 60)

    const s2 = new ShopeeGia([trang([hoiThoai('c3', '1761250000000000000')], false)])
    await s2.getConversationList({ cursor: '1761260000000000000' })
    const p2 = thamSo(s2.url[0]!)
    ok('6. xem tiếp từ cursor: direction=older + next_timestamp_nano = cursor', p2.get('direction') === 'older' && p2.get('next_timestamp_nano') === '1761260000000000000', Object.fromEntries(p2))

    const s3 = new ShopeeGia([
        trang([hoiThoai('a', '30'), hoiThoai('b', '20')], true, '20'),
        trang([hoiThoai('b', '20'), hoiThoai('c', '10')], false),
    ])
    const k3 = await s3.getConversationList({ soTrang: 3 })
    const p3b = thamSo(s3.url[1]!)
    ok('7. lật trang: trang 2 vẫn older + mốc từ trang 1; dừng khi more=false', s3.url.length === 2 && p3b.get('direction') === 'older' && p3b.get('next_timestamp_nano') === '20', s3.url.length)
    ok('8. trùng mép giữa hai trang bị khử, xếp mới → cũ', k3.conversations.map(c => c.conversationId).join() === 'a,b,c', k3.conversations.map(c => c.conversationId))
    ok('9. hết trang ⇒ hasMore=false, nextOffset rỗng', k3.hasMore === false && k3.nextOffset === '')

    const s4 = new ShopeeGia([trang([hoiThoai('z', '5')], true, '')])
    const k4 = await s4.getConversationList({})
    ok('10. more=true nhưng Shopee không đưa mốc ⇒ KHÔNG báo còn (không có cách lấy tiếp)', k4.hasMore === false)

    const s5 = new ShopeeGia([{ error: 'error_auth', message: 'Invalid access_token', response: null }])
    let loi = ''
    try { await s5.getConversationList({}) } catch (e: any) { loi = String(e?.message || e) }
    ok('11. Shopee báo lỗi ⇒ NÉM (để withTokenRefresh / platformChatError xử lý), không trả danh sách rỗng giả', /error_auth/.test(loi), loi)

    console.log('— B. Tín hiệu chat —')
    const sql: string[] = []; const ts: any[][] = []
    const db: any = {
        $executeRawUnsafe: async (q: string, ...a: any[]) => { sql.push(q); ts.push(a); return 1 },
        $queryRawUnsafe: async () => [{ kenhId: 'k1', lanCuoi: new Date('2026-10-24T01:27:00Z'), hoiThoaiId: '4709', soTin: 3 }],
    }
    await ghiTinHieuChat(db, 'k1', '4709')
    await ghiTinHieuChat(db, 'k1', '4710')
    ok('12. tạo bảng lười đúng MỘT lần cho một client', sql.filter(q => q.startsWith('CREATE TABLE')).length === 1)
    ok('13. upsert theo kênh, tăng soTin, chỉ mang mã kênh + mã hội thoại (KHÔNG nội dung tin)', sql.filter(q => q.includes('ON CONFLICT ("kenhId")')).length === 2 && ts[2]!.length === 2 && ts[2]![1] === '4710', ts)
    ok('14. kenhId rỗng ⇒ không ghi gì', await ghiTinHieuChat(db, '', 'x').then(() => sql.length === 3))
    const r = await docTinHieuChat(db)
    ok('15. đọc tín hiệu: ISO + số', r.length === 1 && r[0]!.lanCuoi === '2026-10-24T01:27:00.000Z' && r[0]!.soTin === 3, r)
    const thieu: any = { $queryRawUnsafe: async () => { throw Object.assign(new Error('relation "TinHieuChatSan" does not exist'), { code: 'P2010', meta: { code: '42P01' } }) } }
    ok('16. bảng chưa có (chưa từng nhận push chat) ⇒ rỗng, không lỗi', (await docTinHieuChat(thieu)).length === 0)
    const hong2: any = { $queryRawUnsafe: async () => { throw new Error('connection reset') } }
    let nem = false
    try { await docTinHieuChat(hong2) } catch { nem = true }
    ok('17. lỗi khác (mất kết nối) ⇒ NÉM, không nuốt thành "không có gì mới"', nem)

    console.log('— C. Bên gửi tin —')
    // Số liệu dựng theo hình dạng THẬT đo 24/10: from_id là mã tài khoản (khác hẳn shopId), from_shop_id mới là mã gian
    const tin = (fromId: number, fromShopId: number, toShopId: number, status: string, source: string, text: string) =>
        ({ message_id: `m${fromId}${text.length}`, message_type: 'text', from_id: fromId, from_shop_id: fromShopId, to_id: 1, to_shop_id: toShopId, status, source, created_timestamp: 1761270000, content: { text } })
    const s6 = new ShopeeGia([{ error: '', response: { messages: [
        tin(555000111, 0, 42, 'user_chat', 'ios', 'NOI-DUNG-KHACH-BI-MAT'),
        tin(900000222, 42, 0, 'auto_reply', 'server', 'Xin chao tu dong'),
        tin(900000222, 42, 0, 'normal', 'openapi', 'Bao hanh 12 thang'),
        tin(777000333, 99, 42, 'user_chat', 'android', 'khach co gian rieng'),
    ], page_result: { has_more: false } } }])
    const daLog: string[] = []
    const logGoc = console.log
    console.log = (...a: any[]) => { daLog.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) }
    let k6: Awaited<ReturnType<ShopeeService['getMessages']>>
    try { k6 = await s6.getMessages('c1') } finally { console.log = logGoc }
    const ben = k6.messages.map(m => laTinCuaGian(m, '42') ? 'gian' : 'khach')
    ok('18. bên gửi theo from_shop_id: khách · gian (tự động) · gian (gửi từ Kengi) · khách có gian riêng', ben.join() === 'khach,gian,gian,khach', ben)
    ok('19. KHÔNG còn so from_id với shopId (from_id là mã tài khoản — không bao giờ bằng mã gian)', k6.messages.every(m => String(m.fromId) !== '42') && ben.includes('gian'))
    ok('20. shopId số hay chuỗi đều khớp; shopId rỗng/0 ⇒ không tin nào thành của gian', laTinCuaGian({ fromShopId: 42 }, 42) && laTinCuaGian({ fromShopId: '42' }, '42') && !laTinCuaGian({ fromShopId: 0 }, '0') && !laTinCuaGian({ fromShopId: 0 }, '') && !laTinCuaGian({}, undefined))
    ok('21. tin tự động: auto_reply + offwork_autoreply; normal / user_chat thì không', laTinTuDong({ status: 'auto_reply' }) && laTinTuDong({ status: 'offwork_autoreply' }) && !laTinTuDong({ status: 'normal' }) && !laTinTuDong({ status: 'user_chat' }) && !laTinTuDong({}))
    ok('22. getMessages mang status/source/toShopId cho route dùng', k6.messages[1]!.status === 'auto_reply' && k6.messages[2]!.source === 'openapi' && k6.messages[0]!.toShopId === 42, k6.messages.map(m => [m.status, m.source, m.toShopId]))
    ok('23. get_message KHÔNG ghi nội dung tin của người mua ra log (cam kết với Shopee)', !daLog.some(l => l.includes('NOI-DUNG-KHACH-BI-MAT')), daLog)

    console.log('— D. Gợi ý trả lời —')
    let so = 0
    const k = (content: string, extra: Partial<TinShopeeGoiY> = {}): TinShopeeGoiY => ({ messageId: `k${++so}`, messageType: 'text', content, fromShopId: 0, status: 'user_chat', source: 'ios', ...extra })
    const g = (content: string, extra: Partial<TinShopeeGoiY> = {}): TinShopeeGoiY => ({ messageId: `g${++so}`, messageType: 'text', content, fromShopId: 42, status: 'normal', source: 'mini_webchat', ...extra })
    const tuDong = g('Xin chao tu dong', { status: 'auto_reply', source: 'server' })
    const rong = new Map<string, string>()

    const q2 = k('Q2')
    const t1 = tachCauHoiShopee([k('Q1'), tuDong, g('A1'), q2, { ...tuDong, messageId: 'td2' }], 42, rong)
    ok('24. câu cần trả lời = tin khách SAU câu trả lời cuối của người; tin tự động không tính là đã trả lời', t1?.cauHoi === 'Q2' && t1?.tinCuoiId === q2.messageId, t1)
    ok('25. lịch sử khách–shop xen kẽ, tin liền nhau cùng bên gộp một lượt, kết thúc bằng câu trả lời của shop', JSON.stringify(t1?.lichSu.map(l => [l.role, l.parts[0]!.text])) === JSON.stringify([['user', 'Q1'], ['model', 'Xin chao tu dong\nA1']]), t1?.lichSu)
    ok('26. tin cuối là người của gian trả lời ⇒ không soạn (null)', tachCauHoiShopee([k('Q1'), g('A1')], 42, rong) === null)
    const t2 = tachCauHoiShopee([g('A0'), k('Q1'), k('Q2'), g('', { messageType: 'voucher', source: 'server' })], 42, rong)
    ok('27. nhiều tin khách liền nhau gộp thành một câu; voucher Shopee gửi thay gian không tính là trả lời', t2?.cauHoi === 'Q1\nQ2', t2)
    ok('28. lịch sử mở đầu bằng shop ⇒ bỏ cho lượt đầu là khách (Gemini đòi user/model xen kẽ)', Array.isArray(t2?.lichSu) && t2!.lichSu.length === 0, t2?.lichSu)
    const tenSp = new Map([['111', 'Nồi chiên không dầu 5L (SKU NC5)']])
    const t3 = tachCauHoiShopee([k('', { messageType: 'item', itemId: '111' }), k('còn hàng không shop', { itemId: '111' }), k('', { messageType: 'item', itemId: '999' })], 42, tenSp)
    ok('29. thẻ sản phẩm / tin từ trang sản phẩm ⇒ TÊN + SKU hàng của gian; mã lạ ⇒ ghi mã', t3?.cauHoi === '[Gửi thẻ sản phẩm: Nồi chiên không dầu 5L (SKU NC5)]\ncòn hàng không shop (nhắn từ trang sản phẩm: Nồi chiên không dầu 5L (SKU NC5))\n[Gửi thẻ sản phẩm: mã 999 trên Shopee]', t3?.cauHoi)
    ok('30. thẻ đơn / ảnh ra mô tả ngắn, không để trống', chuTinShopee(k('', { messageType: 'order', orderSn: '2410ABC' }), rong) === '[Gửi thẻ đơn hàng #2410ABC]' && chuTinShopee(k('[Hình ảnh]', { messageType: 'image' }), rong) === '[Gửi ảnh]')
    ok('31. hội thoại rỗng / chỉ có tin tự động ⇒ null', tachCauHoiShopee([], 42, rong) === null && tachCauHoiShopee([tuDong], 42, rong) === null)

    const shops = [
        { id: 'a', ten: 'Kengi', kenh: 'Kengi Store', san: 'tiktok' },
        { id: 'b', ten: 'Kengi Shopee', kenh: 'Kengi  store', san: 'shopee' },
        { id: 'c', ten: 'Kengi Tools', kenh: null, san: '' },
    ]
    ok('32. kho kiến thức: shop chatbot gắn đúng kênh + đúng sàn được ưu tiên (gom khoảng trắng, không phân biệt hoa thường)', chonShopChoKenh(shops, { name: 'Kengi Store', platform: 'shopee' })?.id === 'b')
    ok('33. chưa gắn kênh mà trùng tên kênh ⇒ dùng', chonShopChoKenh(shops, { name: 'kengi tools', platform: 'shopee' })?.id === 'c')
    ok('34. nhiều shop chatbot mà không shop nào khớp ⇒ null (kho rỗng, không lấy nhầm kho gian khác)', chonShopChoKenh(shops, { name: 'Kengi Electric', platform: 'shopee' }) === null)
    ok('35. cửa hàng chỉ có MỘT shop chatbot ⇒ dùng nó cho mọi gian', chonShopChoKenh([shops[2]!], { name: 'Kengi Electric', platform: 'shopee' })?.id === 'c' && chonShopChoKenh([], { name: 'X', platform: 'shopee' }) === null)
    ok('36. luật nháp Shopee: chỉ NHÁP cho người duyệt, cấm SĐT / Zalo / link ngoài / sàn khác', /NHÁP/.test(LUAT_NHAP_SAN.shopee!) && /số điện thoại/.test(LUAT_NHAP_SAN.shopee!) && /Zalo/.test(LUAT_NHAP_SAN.shopee!) && /sàn khác/.test(LUAT_NHAP_SAN.shopee!))
    // Câu Google trả THẬT ngày 24/10 (key KENGISTORE): HTTP 402 hết tín dụng trả trước — bộ chạy AI xếp vào LoiGeminiHetTien
    // (fetch 402 ⇒ LoiGeminiHetTien: check-ai-agent-gemini)
    const loi402 = loiAiChoNguoiDung(new LoiGeminiHetTien('gemini-3.8-flash: HTTP 402 — Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.'))
    ok('37. key Gemini hết tiền (402) ⇒ câu tiếng Việt bảo NẠP TIỀN / đổi key — không "thử lại sau" (lớp con của lỗi tạm thời), không câu Anh', /HẾT TIỀN/.test(loi402) && /Cài đặt › Trợ lý AI/.test(loi402) && !/thử lại sau/.test(loi402) && !/prepayment/.test(loi402), loi402)
    ok('38. quá tải tạm thời ⇒ "thử lại sau"; key sai ⇒ kiểm tra key; lỗi lạ ⇒ giữ nguyên (cắt 200)', /thử lại sau/.test(loiAiChoNguoiDung(new LoiGeminiTamThoi('429 RESOURCE_EXHAUSTED'))) && /sai hoặc đã bị khoá/.test(loiAiChoNguoiDung(new Error('HTTP 400: API key not valid'))) && loiAiChoNguoiDung(new Error('x'.repeat(300))).length === 'AI lỗi: '.length + 200)
    // lỗi thường còn mang "402" giờ chỉ là DeepSeek (Gemini 402 đã thành LoiGeminiHetTien ở bộ chạy)
    const loiDS = loiAiChoNguoiDung(new Error('Tài khoản DeepSeek hết tiền (402) — nạp thêm ở platform.deepseek.com: Insufficient Balance'))
    ok('39. DeepSeek hết tiền (402) ⇒ nói đúng DeepSeek, không báo nhầm thành key Gemini', /DeepSeek hết tiền/.test(loiDS) && !/Gemini/.test(loiDS), loiDS)

    console.log(`\n${dat} đạt, ${hong} hỏng`)
    process.exit(hong ? 1 : 0)
}
main().catch((e) => { console.error('LỖI:', e?.stack || e); process.exit(1) })
