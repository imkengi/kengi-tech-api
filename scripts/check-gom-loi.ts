/**
 * Kiểm GOM LỖI PRODUCTION — npx tsx scripts/check-gom-loi.ts
 *
 * Trung tâm lỗi (`GET /admin/errors`) chỉ có giá trị nhờ phép gom. Hàm gom hỏng
 * theo HAI chiều và cả hai đều im lặng:
 *   - Gom QUÁ TAY → hai bệnh khác nhau dính làm một, cái hiếm bị cái phổ biến
 *     che mất. Người dùng nhìn thấy "1 nhóm" và yên tâm.
 *   - Gom QUÁ ÍT → một lỗi lặp lại nổ thành hàng trăm nhóm, màn hình đầy nhiễu,
 *     người dùng bỏ qua luôn.
 *
 * Nên mỗi luật ở đây đều có ca PHẢI GOM và ca PHẢI TÁCH.
 *
 * Dữ liệu mẫu lấy từ log thật ngày 14–15/08/2026.
 */

import { chuKyLoi, chuanHoaDuong, gomLoi, moTaLoi } from '../src/lib/gomLoi'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

function main() {
    console.log('\n▶ Gom lỗi production thành nhóm\n')

    // ── 1. PHẢI GOM: cùng bệnh, chỉ khác phần biến thiên ──────────────────
    const pool = 'Timed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 30, connection limit: 3)'
    ok('1. hai dòng cạn pool giống hệt → cùng chữ ký', chuKyLoi(pool) === chuKyLoi(pool))

    const cuid1 = 'Get channel cmrk4lhlp000as60124f7sab1 failed'
    const cuid2 = 'Get channel cmzz9qqqq111bs60999g8xyz2 failed'
    ok('2. khác mỗi cuid → GOM chung', chuKyLoi(cuid1) === chuKyLoi(cuid2), [chuKyLoi(cuid1), chuKyLoi(cuid2)])

    const t1 = 'Sync failed at 2026-08-14T15:21:00.123Z for store'
    const t2 = 'Sync failed at 2026-08-15T03:02:11.999Z for store'
    ok('3. khác mỗi mốc thời gian → GOM chung', chuKyLoi(t1) === chuKyLoi(t2), [chuKyLoi(t1), chuKyLoi(t2)])

    const u1 = 'job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 died'
    const u2 = 'job 7a1b2c3d-9999-11d3-9a0c-0305e82c3399 died'
    ok('4. khác mỗi uuid → GOM chung', chuKyLoi(u1) === chuKyLoi(u2), [chuKyLoi(u1), chuKyLoi(u2)])

    const s1 = 'HTTP 500 https://kengi-tech-api-445765742612.asia-southeast1.run.app/api/notifications'
    const s2 = 'HTTP 500 https://kengi-tech-api-999999999999.asia-southeast1.run.app/api/notifications'
    ok('5. khác mỗi số dài trong host → GOM chung', chuKyLoi(s1) === chuKyLoi(s2), [chuKyLoi(s1)])

    /* ── 6. PHẢI TÁCH: bệnh khác nhau thì tuyệt đối không được dính ────────
     * Đây là chiều nguy hiểm hơn — gom nhầm thì lỗi hiếm bị che, mà lỗi hiếm
     * thường mới là lỗi mới. */
    ok('6. cạn pool vs thiếu cột → TÁCH',
        chuKyLoi(pool) !== chuKyLoi('The column `OnlineOrderItem.externalItemId` does not exist in the current database.'))
    ok('6b. hai cột thiếu KHÁC NHAU → TÁCH',
        chuKyLoi('The column `A.x` does not exist in the current database.')
        !== chuKyLoi('The column `B.y` does not exist in the current database.'))
    ok('6c. 500 vs 502 cùng đường → TÁCH',
        chuKyLoi('HTTP 500 /api/x') !== chuKyLoi('HTTP 502 /api/x'))
    ok('6d. cùng mã lỗi, khác đường → TÁCH',
        chuKyLoi('HTTP 500 /api/notifications') !== chuKyLoi('HTTP 500 /api/events'))

    /* 6e — MÃ TRẠNG THÁI PHẢI SỐNG SÓT.
     * Luật "bỏ số từ 5 chữ số trở lên" cố ý không đụng số 3 chữ số, nếu không
     * thì 500/502/504 thành một nhóm và mất hẳn khả năng phân biệt. */
    ok('6e. mã 3 chữ số không bị nuốt', /500/.test(chuKyLoi('HTTP 500 /api/x')))

    // ── 7. Chuẩn hoá đường dẫn ────────────────────────────────────────────
    ok('7. bỏ host và query',
        chuanHoaDuong('https://api.kengi.vn/api/online-orders/chat?channelId=abc') === '/api/online-orders/chat',
        chuanHoaDuong('https://api.kengi.vn/api/online-orders/chat?channelId=abc'))
    ok('7b. cuid trong đường → :id',
        chuanHoaDuong('/api/online-orders/channels/cmrk4lhlp000as60124f7sab1/sync') === '/api/online-orders/channels/:id/sync',
        chuanHoaDuong('/api/online-orders/channels/cmrk4lhlp000as60124f7sab1/sync'))
    ok('7c. KHÔNG nuốt đoạn đường có nghĩa',
        chuanHoaDuong('/api/transactions/by-salesperson') === '/api/transactions/by-salesperson',
        chuanHoaDuong('/api/transactions/by-salesperson'))

    /* ── 8. LOG REQUEST CLOUD RUN KHÔNG CÓ NỘI DUNG ỨNG DỤNG.
     * Đo thật 15/08/2026: 985 request 5xx trong 24h mà textPayload lẫn
     * jsonPayload đều RỖNG. Chỉ đọc payload là đám này biến mất và màn hình
     * báo "0 lỗi" — đúng kiểu trấn an sai mà trung tâm lỗi sinh ra để chặn. */
    const kq = gomLoi([
        { httpRequest: { requestUrl: 'https://x/api/notifications', status: 500 }, timestamp: '2026-08-14T08:00:00Z' },
        { httpRequest: { requestUrl: 'https://x/api/notifications', status: 500 }, timestamp: '2026-08-14T08:05:00Z' },
        { textPayload: pool, timestamp: '2026-08-14T09:00:00Z' },
    ])
    ok('8. entry không payload vẫn thành nhóm (không biến mất)', kq.nhom.length === 2, kq.nhom.map(n => n.chuKy.slice(0, 40)))
    ok('8b. đếm đúng số 5xx', kq.so5xx === 2, kq.so5xx)
    ok('8c. gom đúng hai lần cùng đường', kq.nhom[0]?.so === 2, kq.nhom[0]?.so)
    ok('8d. xếp nhóm nhiều nhất lên đầu', (kq.nhom[0]?.so ?? 0) >= (kq.nhom[1]?.so ?? 0))
    ok('8e. đường lỗi gom theo route', kq.duongLoi[0]?.duong === '/api/notifications', kq.duongLoi)

    // 9 — mốc thời gian sớm/muộn phải đúng, giao diện hiện khoảng
    ok('9. giữ đúng mốc sớm nhất và muộn nhất',
        kq.nhom[0]?.somNhat === '2026-08-14T08:00:00Z' && kq.nhom[0]?.muonNhat === '2026-08-14T08:05:00Z',
        { som: kq.nhom[0]?.somNhat, muon: kq.nhom[0]?.muonNhat })

    // 10 — CHIỀU IM: không có gì thì đừng bịa ra nhóm
    const rong = gomLoi([])
    ok('10. danh sách rỗng → không nhóm nào, không lỗi', rong.nhom.length === 0 && rong.so5xx === 0)
    const khong5xx = gomLoi([{ httpRequest: { requestUrl: 'https://x/api/ok', status: 200 }, timestamp: 'T' }])
    ok('10b. request 200 không bị tính là lỗi', khong5xx.nhom.length === 0 && khong5xx.so5xx === 0,
        { nhom: khong5xx.nhom.length, so5xx: khong5xx.so5xx })

    // 11 — chữ ký phải bị cắt để một stack trace dài không phá màn hình
    const dai = 'Error: ' + 'x'.repeat(2000)
    ok('11. chữ ký bị cắt ngắn', chuKyLoi(dai).length <= 220, chuKyLoi(dai).length)
    ok('11b. mẫu gốc vẫn giữ nhiều hơn chữ ký (để bấm xem chi tiết)',
        (gomLoi([{ textPayload: dai, timestamp: 'T' }]).nhom[0]?.mau.length ?? 0) > 220)

    /* ── moTaLoi: KHÔNG BAO GIỜ ĐƯỢC TRẢ CHUỖI RỖNG ────────────────────────
     * Ca sinh tử là lỗi rỗng cả `name` lẫn `message`: `String(err)` gọi
     * Error.prototype.toString(), name rỗng thì trả về message — cũng rỗng.
     * Đã đẻ ra 8 dòng log dài đúng 55 ký tự lúc 13:52 UTC ngày 16/08. */
    const loiRong = new Error(''); loiRong.name = ''
    const taRong = moTaLoi(loiRong)
    ok('M1. lỗi rỗng name+message → VẪN mô tả được', taRong.length > 0, taRong)
    ok('M1b. nói rõ là lỗi rỗng chứ không bịa', /RỖNG/.test(taRong), taRong)
    ok('M1c. giữ được khung gọi từ stack để lần ra chỗ ném', /tại /.test(taRong), taRong)

    /* M1d — CA ĐÃ QUA MẶT BẢN ĐẦU TIÊN: message chỉ là ký tự xuống dòng.
     * `"\n"` là truthy nên hàm trả về "\n", Cloud Logging cắt xuống dòng ở cuối
     * ⇒ dòng log ra ĐÚNG 55 ký tự, không phân biệt được với mã chưa vá. Đã làm
     * tôi đi nghi Cloud Build đẩy nguồn cũ suốt một vòng dài. */
    const xuongDong: any = new Error('\n'); xuongDong.name = ''
    const taXD = moTaLoi(xuongDong)
    ok('M1d. message chỉ có xuống dòng → KHÔNG được coi là có nội dung',
        taXD.trim().length > 0 && /RỖNG/.test(taXD), JSON.stringify(taXD))
    const khoangTrang: any = new Error('   '); khoangTrang.name = '  '
    ok('M1e. message/name toàn khoảng trắng → cũng vậy',
        /RỖNG/.test(moTaLoi(khoangTrang)), JSON.stringify(moTaLoi(khoangTrang)))
    ok('M1f. kết quả KHÔNG BAO GIỜ chứa xuống dòng (một dòng log là một dòng)',
        !/\n/.test(taXD), JSON.stringify(taXD))

    /* M1g — LỖI PRISMA THẬT: thông báo nhiều dòng. Để nguyên xuống dòng là một
     * lỗi vỡ thành nhiều bản ghi rời trong Cloud Logging, mất luôn liên hệ với
     * mã đơn ở đầu dòng — chính thứ làm 4 ngày không chẩn được. */
    const nhieuDong: any = new Error('\nInvalid `prisma.onlineOrder.findMany()` invocation:\n\n  Timed out fetching a new connection\n')
    nhieuDong.code = 'P2024'
    const taND = moTaLoi(nhieuDong)
    ok('M1g. thông báo nhiều dòng → gộp về MỘT dòng', !/\n/.test(taND), JSON.stringify(taND).slice(0, 120))
    ok('M1g2. vẫn giữ nguyên nội dung và mã lỗi',
        /P2024/.test(taND) && /Timed out fetching/.test(taND), taND.slice(0, 90))

    // M2 — lỗi Prisma thường: code là thứ quan trọng nhất, phải đứng đầu
    const pri: any = new Error(''); pri.code = 'P2024'; pri.meta = { limit: 1 }
    const taPri = moTaLoi(pri)
    ok('M2. giữ code Prisma', /code=P2024/.test(taPri), taPri)
    ok('M2b. giữ meta', /meta=/.test(taPri), taPri)

    // M3 — lỗi thường thì đừng làm ồn, chỉ trả message
    ok('M3. lỗi thường → đúng message', moTaLoi(new Error('hỏng rồi')) === 'hỏng rồi', moTaLoi(new Error('hỏng rồi')))

    // M4 — CHIỀU IM của kiểu dữ liệu méo: null/undefined/chuỗi không được nổ
    ok('M4. null → vẫn ra chữ', moTaLoi(null).length > 0, moTaLoi(null))
    ok('M4b. undefined → vẫn ra chữ', moTaLoi(undefined).length > 0, moTaLoi(undefined))
    ok('M4c. ném chuỗi rỗng → vẫn ra chữ', moTaLoi('').length > 0, moTaLoi(''))
    ok('M4d. ném chuỗi thường → giữ nguyên', moTaLoi('sập' as any) === 'sập', moTaLoi('sập' as any))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
