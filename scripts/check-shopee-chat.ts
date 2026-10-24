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
 */
process.env.SHOPEE_FORWARD_PROXY = ''   // không bao giờ ra mạng: httpGet bị thay bằng bản giả

import { ShopeeService } from '../src/services/platforms/shopee'
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

    console.log(`\n${dat} đạt, ${hong} hỏng`)
    process.exit(hong ? 1 : 0)
}
main().catch((e) => { console.error('LỖI:', e?.stack || e); process.exit(1) })
