/**
 * Kiểm THẢI CLIENT NHÀN RỖI — npx tsx scripts/check-thai-client.ts
 *
 * Bộ thải đóng client cửa hàng không được đụng tới quá 10 phút. Sai một chiều
 * là hai kiểu hỏng trái ngược:
 *
 *   - Thải THIẾU → cửa hàng ngồi im vẫn ôm kết nối, chạm trần Cloud SQL
 *     (chuyện đã xảy ra trước 16/08: nền 46/50).
 *   - Thải THỪA → đóng client ngay dưới chân cron đang chạy dài (đêm 17→18/08:
 *     container tự tắt 12 lần, 289 đơn chuyển hỏng cùng một phút).
 *
 * Nên bộ này có CẢ HAI chiều cho mỗi luật.
 */

import { chonClientDeThai, type TrangThaiClient } from '../src/lib/thaiClientNhanRoi'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const PHUT = 60_000
const NGUONG = 10 * PHUT
const NAY = 1_000_000_000_000
const c = (schema: string, roiPhut: number, dangBan = 0): TrangThaiClient =>
    ({ schema, lastUsed: NAY - roiPhut * PHUT, dangBan })

function main() {
    console.log('\n▶ Thải client nhàn rỗi — không được đóng client cron đang dùng\n')

    // 1 — cửa hàng ngồi im quá ngưỡng, không ai giữ → THẢI (nửa đúng của cơ chế cũ)
    ok('1. rỗi 15 phút, không ai giữ → thải', chonClientDeThai([c('a', 15)], NAY, NGUONG).join() === 'a')

    // 2 — còn tươi → giữ
    ok('2. rỗi 3 phút → giữ', chonClientDeThai([c('a', 3)], NAY, NGUONG).length === 0)

    /* 3 — CA SỰ CỐ ĐÊM 17→18/08: cron giữ client, không ai chạm lastUsed suốt
     * 25 phút (kéo lịch sử). Cơ chế cũ thải ở phút 10 → engine chết dưới chân
     * cron. Nay có dangBan > 0 thì PHẢI GIỮ dù rỗi bao lâu. */
    ok('3. rỗi 25 phút NHƯNG cron đang giữ (dangBan=1) → KHÔNG thải',
        chonClientDeThai([c('kengistore', 25, 1)], NAY, NGUONG).length === 0)
    ok('3b. rỗi cả tiếng mà vẫn đang giữ → vẫn không thải',
        chonClientDeThai([c('kengistore', 60, 1)], NAY, NGUONG).length === 0)

    // 4 — nhiều lượt cùng giữ (autoSync + feeSync + reconcile) → vẫn không thải
    ok('4. dangBan=3 → không thải', chonClientDeThai([c('a', 30, 3)], NAY, NGUONG).length === 0)

    /* 5 — CHIỀU IM của việc giữ: nhả xong (dangBan về 0) và rỗi quá ngưỡng thì
     * PHẢI thải lại bình thường — nếu không, cơ chế giữ biến thành rò rỉ và ta
     * quay về đúng bệnh cũ (46/50 nền). */
    ok('5. đã nhả (dangBan=0) + rỗi 15 phút → thải lại bình thường',
        chonClientDeThai([c('a', 15, 0)], NAY, NGUONG).join() === 'a')

    // 6 — trộn: chỉ đúng cái đủ điều kiện bị thải
    const tron = chonClientDeThai([
        c('roi-khong-giu', 15, 0),
        c('roi-dang-giu', 15, 1),
        c('tuoi', 2, 0),
        c('tuoi-dang-giu', 2, 1),
    ], NAY, NGUONG)
    ok('6. lô trộn → chỉ thải đúng cái rỗi VÀ không ai giữ', tron.join() === 'roi-khong-giu', tron)

    // 7 — biên: đúng bằng ngưỡng thì thải (>= ngưỡng)
    ok('7. rỗi ĐÚNG 10 phút → thải (biên)', chonClientDeThai([c('a', 10)], NAY, NGUONG).length === 1)

    // 8 — rỗng / dangBan âm (dữ liệu méo) không được nổ, âm coi như 0
    ok('8. danh sách rỗng → không nổ', chonClientDeThai([], NAY, NGUONG).length === 0)
    ok('8b. dangBan âm (méo) → coi như không ai giữ, thải bình thường',
        chonClientDeThai([c('a', 15, -1)], NAY, NGUONG).length === 1)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()

/* ── THỨ TỰ TẮT CONTAINER (thêm 18/08/2026) ─────────────────────────────────
 * Đo 02:01 UTC: `disconnectAll()` chạy TRƯỚC `stopAutoSync()` → cron đang chuyển
 * đơn mất engine dưới chân, 20 lỗi + 11 đơn hỏng đúng 286 ms sau SIGTERM. Luật:
 * trong hàm shutdown của src/index.ts, `stopAutoSync()` và `choAutoSyncXong(`
 * phải đứng TRƯỚC `disconnectAll()`. Kiểm bằng văn bản vì không khởi động được
 * server trong test. */
import * as fs from 'fs'
{
    const s = fs.readFileSync('src/index.ts', 'utf8')
    const i = s.indexOf('const shutdown = async () => {')
    const doan = i >= 0 ? s.slice(i, i + 1500) : ''
    const viTri = (k: string) => { const p = doan.indexOf(k); return p < 0 ? Infinity : p }
    const okThuTu = viTri('batCoDangTat()') < viTri('stopAutoSync()')
        && viTri('stopAutoSync()') < viTri('disconnectAll()') && viTri('choAutoSyncXong(') < viTri('disconnectAll()')
    let dat2 = 0, hong2 = 0
    const ok2 = (t: string, d: boolean, x?: any) => { if (d) { dat2++; console.log(`  ✓ ${t}`) } else { hong2++; console.log(`  ✗ ${t}${x !== undefined ? ` — ${JSON.stringify(x)}` : ''}`) } }
    console.log('\n▶ Thứ tự tắt container: dừng cron → chờ xong → mới đóng DB\n')
    ok2('tìm thấy hàm shutdown trong src/index.ts', i >= 0)
    ok2('batCoDangTat() ĐẦU TIÊN, rồi stopAutoSync() và choAutoSyncXong() TRƯỚC disconnectAll()', okThuTu,
        { co: viTri('batCoDangTat()'), stop: viTri('stopAutoSync()'), cho: viTri('choAutoSyncXong('), disc: viTri('disconnectAll()') })
    // Vòng lặp chuyển đơn PHẢI kiểm cờ — nếu không, chờ 6 s vẫn không kịp (đo 03:02 UTC: 11 đơn)
    const os = fs.readFileSync('src/services/orderSync.ts', 'utf8')
    const iFor = os.indexOf('for (const order of orders) {')
    ok2('processNewOrders kiểm dangTat() ngay đầu vòng lặp từng đơn', iFor > 0 && os.slice(iFor, iFor + 600).includes('if (dangTat())'))
    ok2('có trần chờ (không chờ vô hạn — Cloud Run kill sau ~10s)', /choAutoSyncXong\(\s*\d+/.test(doan))
    console.log(`\n${dat2}/${dat2 + hong2} ca đạt`)
    if (hong2) process.exit(1)
}

/* ── choXong: chờ lượt đang chạy, CÓ TRẦN (thêm 18/08/2026) ─────────────────
 * Đồng hồ và giấc ngủ đều GIẢ để kiểm ba nhánh trong vài ms thật. */
import { choXong } from '../src/lib/choXong'
{
    let dat3 = 0, hong3 = 0
    const ok3 = (t: string, d: boolean, x?: any) => { if (d) { dat3++; console.log(`  ✓ ${t}`) } else { hong3++; console.log(`  ✗ ${t}${x !== undefined ? ` — ${JSON.stringify(x)}` : ''}`) } }
    console.log('\n▶ Chờ cron xong trước khi đóng DB — có trần\n')

    // Dựng đồng hồ giả: mỗi lần "ngủ" thì thời gian nhảy đúng bấy nhiêu ms
    const dong = () => { let t = 0; return { bayGio: () => t, ngu: async (ms: number) => { t += ms }, } }

    /* DÂY AN TOÀN cho chính bộ kiểm: nếu choXong mất trần (đột biến), ca 3 sẽ
     * TREO VÔ HẠN chứ không sập — CI im lặng, tệ hơn đỏ. Đồng hồ giả không
     * cứu được vì vòng while không bao giờ nhả. Nên tự bắn ra sau 5 s thật. */
    const dayAnToan = setTimeout(() => { console.log('  ✗ BỘ KIỂM TREO >5s — nhiều khả năng choXong đã mất trần (vòng while không nhả)'); process.exit(1) }, 5_000)
    ;(async () => {
        // 1 — đang rỗi → về ngay, không ngủ lần nào
        { const c = dong(); let soLanNgu = 0
          const kq = await choXong(() => false, 6000, 200, async ms => { soLanNgu++; await c.ngu(ms) }, c.bayGio)
          ok3('1. đang rỗi → true ngay, 0 lần ngủ', kq === true && soLanNgu === 0, { kq, soLanNgu }) }

        // 2 — đang chạy, xong sau 1,4 s → chờ đúng ~1,4 s rồi true (không chờ hết 6 s)
        { const c = dong()
          const kq = await choXong(() => c.bayGio() < 1400, 6000, 200, c.ngu, c.bayGio)
          ok3('2. chạy rồi xong ở 1,4s → true, dừng ở ~1,4s (không đợi hết trần)', kq === true && c.bayGio() >= 1400 && c.bayGio() < 2000, { kq, luc: c.bayGio() }) }

        /* 3 — CA SINH TỬ: chạy MÃI không xong → PHẢI bỏ cuộc đúng trần 6 s.
         * Cloud Run kill cứng ~10 s sau SIGTERM; chờ vô hạn = bị kill = mất
         * cả cơ hội đóng DB tử tế. */
        { const c = dong()
          const kq = await choXong(() => true, 6000, 200, c.ngu, c.bayGio)
          ok3('3. chạy mãi → false, bỏ cuộc đúng trần 6s (KHÔNG chờ vô hạn)', kq === false && c.bayGio() >= 6000 && c.bayGio() < 6400, { kq, luc: c.bayGio() }) }

        // 4 — trần 0 → không ngủ, trả trạng thái hiện tại
        { const c = dong(); let n = 0
          const kq = await choXong(() => true, 0, 200, async ms => { n++; await c.ngu(ms) }, c.bayGio)
          ok3('4. trần 0 → không ngủ, trả false nếu vẫn chạy', kq === false && n === 0, { kq, n }) }

        // 5 — THỨ TỰ THẬT trong shutdown: choXong xong RỒI mới được đóng DB (mô phỏng chuỗi)
        { const c = dong(); const thuTu: string[] = []
          const nha = choXong(() => c.bayGio() < 800, 6000, 200, c.ngu, c.bayGio).then(() => thuTu.push('cho-xong'))
          await nha; thuTu.push('dong-db')
          ok3('5. chuỗi shutdown: chờ xong TRƯỚC, đóng DB SAU', thuTu.join('>') === 'cho-xong>dong-db', thuTu) }

        clearTimeout(dayAnToan)
        console.log(`\n${dat3}/${dat3 + hong3} ca đạt`)
        if (hong3) process.exit(1)
    })()
}

/* ── cờ đang tắt: logic thuần ──────────────────────────────────────────────── */
import { batCoDangTat, dangTat, _resetCoDangTat } from '../src/lib/choXong'
{
    let d4 = 0, h4 = 0
    const ok4 = (t: string, d: boolean, x?: any) => { if (d) { d4++; console.log(`  ✓ ${t}`) } else { h4++; console.log(`  ✗ ${t}${x !== undefined ? ` — ${JSON.stringify(x)}` : ''}`) } }
    console.log('\n▶ Cờ đang tắt\n')
    _resetCoDangTat()
    ok4('1. mặc định KHÔNG tắt', dangTat() === false)
    batCoDangTat()
    ok4('2. bật xong → dangTat() = true', dangTat() === true)
    batCoDangTat()
    ok4('3. bật hai lần vẫn true (idempotent)', dangTat() === true)
    // Mô phỏng vòng lặp: 5 đơn, cờ bật sau đơn thứ 2 → chỉ xử lý 2, còn 3 để lượt sau
    _resetCoDangTat()
    let xuLy = 0
    for (const _ of [1, 2, 3, 4, 5]) { if (dangTat()) break; xuLy++; if (xuLy === 2) batCoDangTat() }
    ok4('4. vòng lặp thoát ngay khi cờ bật giữa chừng (2/5 đơn, không làm nốt)', xuLy === 2, xuLy)
    _resetCoDangTat()
    console.log(`\n${d4}/${d4 + h4} ca đạt`)
    if (h4) process.exit(1)
}

/* ── Cờ thoát sớm TRÊN HÀM THẬT processNewOrders (thêm 18/08/2026) ───────────
 * Điều kiện prod chưa gặp (đến 11:30 VN): SIGTERM khi vòng lặp còn NHIỀU đơn dở.
 * Ở đây mô phỏng bằng prisma giả: 20 đơn, bật cờ sau đơn thứ 3 → phải dừng ngay,
 * không đụng 17 đơn còn lại, và log phải nói đúng "đã xử lý 3/20, còn 17". */
import { processNewOrders } from '../src/services/orderSync'
{
    let d5 = 0, h5 = 0
    const ok5 = (t: string, d: boolean, x?: any) => { if (d) { d5++; console.log(`  ✓ ${t}`) } else { h5++; console.log(`  ✗ ${t}${x !== undefined ? ` — ${JSON.stringify(x)}` : ''}`) } }
    console.log('\n▶ Cờ thoát sớm trên processNewOrders thật (prisma giả)\n')
    ;(async () => {
        _resetCoDangTat()
        let cham = 0
        const logCu = console.log
        const dongLog: string[] = []
        console.log = (...a: any[]) => { const s = a.join(' '); if (/Đang tắt/.test(s)) dongLog.push(s); else logCu(...a) }
        const gia: any = {
            onlineOrder: {
                findMany: async () => Array.from({ length: 20 }, (_, i) => ({ id: 'o' + i, orderNumber: 'SPE-' + i })),
                findUnique: async ({ where }: any) => { cham++; if (cham === 3) batCoDangTat(); return { id: where.id, orderNumber: 'x', status: 'nope', items: [] } },
            },
            transaction: { findFirst: async () => null },
        }
        await processNewOrders(gia, 'c1')
        console.log = logCu
        ok5('1. bật cờ sau đơn 3/20 → dừng ngay, không đụng 17 đơn còn lại', cham === 3, cham)
        ok5('2. log nói đúng "đã xử lý 3/20, còn 17"', dongLog.some(s => /đã xử lý 3\/20, còn 17/.test(s)), dongLog)
        // CHIỀU IM: không bật cờ → chạy hết 20
        _resetCoDangTat(); cham = 0
        const gia2: any = { ...gia, onlineOrder: { ...gia.onlineOrder, findUnique: async ({ where }: any) => { cham++; return { id: where.id, orderNumber: 'x', status: 'nope', items: [] } } } }
        await processNewOrders(gia2, 'c1')
        ok5('3. không bật cờ → chạy hết 20/20', cham === 20, cham)
        _resetCoDangTat()
        console.log(`\n${d5}/${d5 + h5} ca đạt`)
        if (h5) process.exit(1)
    })()
}
