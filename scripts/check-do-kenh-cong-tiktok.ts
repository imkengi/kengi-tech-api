/**
 * check-do-kenh-cong-tiktok — hai chỗ còn dồn cục sau hàng chờ proxy Tino (17/11/2026).
 *
 * Bệnh (đo log prod 7 ngày 11–17/11/2026):
 *  • webhook dò "shop này thuộc cửa hàng nào": bản Cloud Run vừa bật giữa đợt dồn ⇒ ~100 push cùng tự dò, mỗi lượt mở client
 *    TỪNG cửa hàng ⇒ 16/11 07:03: 689 "Too many database connections" trong 25 giây; 7 ngày 235 push hỏng ở bước dò;
 *  • API tài chính TikTok: 963 lần 36009002 (hạn mức chung cả nhóm app), và getOrderSettlement trả null cho MỌI mã lỗi ⇒
 *    lượt bị chặn hiện thành "sàn chưa có số", lượt bù hoa hồng nghỉ đơn 24 giờ.
 *
 *  A. Cổng tài chính (taoCongGioiHan, đồng hồ giả): mỗi lần MỘT lời gọi theo thứ tự tới; hai lần bắt đầu cách ≥ gianCachMs;
 *     36009002 ⇒ ném LoiTikTokGioiHan, lời gọi đang chờ ném NGAY và KHÔNG chạy; hết nghỉ ⇒ mở lại; mã khác ⇒ trả nguyên
 *     (ca phải im); lỗi mạng ⇒ ném nguyên, hàng không gãy; HTTP 429 ⇒ đóng cổng; chờ quá lâu ⇒ bỏ, không chạy.
 *  B. TikTokService (fetch giả): /finance/* qua cổng (tuần tự), đường khác KHÔNG (song song như cũ); bị chặn ⇒ một lời gọi
 *     thật, phần còn lại không gửi; getOrderSettlement bị chặn ⇒ NÉM, mã khác ⇒ null.
 *  C. buHoaHongAffiliate: bị chặn ⇒ dừng kênh, đơn KHÔNG bị nghỉ 24 giờ (lượt sau hỏi lại đủ).
 *  D. Dò kênh webhook (registry giả): 60 push cùng shop trên bản lạnh ⇒ MỘT lượt dò (3 truy vấn registry, 0 client cửa
 *     hàng); trúng đệm ⇒ 0 truy vấn; thứ tự cửa hàng như cũ + một dòng cảnh báo trùng; không có ⇒ null và KHÔNG đệm; đọc hỏng
 *     ⇒ mọi push chờ chung nhận lỗi, KHÔNG đệm; TikTok thiếu cột platformShopId ⇒ dò bằng shopId; bảng thiếu / tên schema lạ
 *     bị bỏ; shop_id chỉ đi qua tham số; đệm trỏ sai ⇒ bỏ đệm, dò lại MỘT lần, không lặp.
 *  E. Nối dây: webhooks.ts hết tự quét store.findMany; FeeSync / nút "Lấy phí" / trang soát admin đếm riêng bị chặn.
 *
 * Không gọi mạng, không đụng CSDL. Chạy: npm run check:do-kenh-cong-tiktok
 */
import * as fs from 'fs'
import * as path from 'path'

let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }
const nguThat = (ms: number) => new Promise(r => setTimeout(r, ms))
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }
const doc = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

async function main() {
    // Cổng dùng chung đọc env lúc nạp module ⇒ đặt nhịp nhanh TRƯỚC khi import (prod: 700 ms / 60 s / 90 s).
    process.env.TIKTOK_TAI_CHINH_GIAN_CACH_MS = '25'
    process.env.TIKTOK_TAI_CHINH_NGHI_MS = '300'
    process.env.TIKTOK_TAI_CHINH_CHO_TOI_DA_MS = '20000'
    const cg = await import('../src/lib/congTaiChinhTikTok')
    const { TikTokService } = await import('../src/services/platforms/tiktok')
    const { buHoaHongAffiliate } = await import('../src/cron/autoSync')
    const { mapWithConcurrency } = await import('../src/lib/prisma')
    const tk = await import('../src/lib/timKenhWebhook')

    const logGoc = { log: console.log, warn: console.warn }
    let canhBao: string[] = []
    const imLog = () => { console.log = () => { }; console.warn = (...a: any[]) => { canhBao.push(a.join(' ')) } }
    const moLog = () => { console.log = logGoc.log; console.warn = logGoc.warn }

    // ─── A. Cổng tài chính — đồng hồ giả ───────────────────────────────────────────
    {
        let nay = 1_000_000
        const dongLog: string[] = []
        const taoCong = (choToiDaMs = 90_000) => cg.taoCongGioiHan({
            gianCachMs: 700, nghiMs: 60_000, choToiDaMs,
            bayGio: () => nay, ngu: async ms => { nay += ms }, ghiLog: d => dongLog.push(d),
        })

        // A1–A2: tuần tự, đúng thứ tự, cách ≥ 700 ms
        const cong = taoCong()
        let dang = 0, dinh = 0
        const thuTu: number[] = [], batDauLuc: number[] = []
        const kq = await Promise.all([0, 1, 2, 3, 4].map(i => cong.qua(async () => {
            dang++; dinh = Math.max(dinh, dang); thuTu.push(i); batDauLuc.push(nay)
            await Promise.resolve(); nay += 100
            dang--
            return { code: 0, i }
        })))
        const cach = batDauLuc.slice(1).map((t, i) => t - batDauLuc[i])
        ca('A1. mỗi lần MỘT lời gọi, đúng thứ tự tới, kết quả trả đúng người gọi',
            dinh === 1 && thuTu.join() === '0,1,2,3,4' && kq.map(r => r.i).join() === '0,1,2,3,4', JSON.stringify({ dinh, thuTu }))
        ca('A2. hai lần bắt đầu cách nhau ≥ 700 ms (lời gọi 100 ms ⇒ chờ thêm 600 ms)', cach.every(c => c >= 700), JSON.stringify(cach))

        // A3: 36009002 ⇒ lời gọi đó ném (chuaGui=false), 3 lời gọi đang chờ ném NGAY (chuaGui=true) và không chạy
        const cong2 = taoCong()
        let soLanChay = 0
        const ketQua3 = await Promise.allSettled([0, 1, 2, 3].map(i => cong2.qua(async () => {
            soLanChay++
            return i === 0 ? { code: 36009002, message: 'shared app-group rate limit' } : { code: 0 }
        })))
        const loi3 = ketQua3.map(r => r.status === 'rejected' ? (r as any).reason : null)
        ca('A3. TikTok trả 36009002 ⇒ ném LoiTikTokGioiHan; 3 lời gọi đang chờ ném ngay, KHÔNG gửi; cổng đóng; một dòng log',
            loi3.every(e => cg.laLoiTikTokGioiHan(e)) && loi3[0].chuaGui === false && loi3.slice(1).every(e => e.chuaGui === true)
            && soLanChay === 1 && cong2.dangDong() && cong2.soLanBiChan() === 1 && dongLog.length === 1 && /36009002/.test(dongLog[0]),
            JSON.stringify({ soLanChay, chuaGui: loi3.map(e => e?.chuaGui), log: dongLog }))
        // gọi MỚI trong lúc đóng cũng không gửi
        const loiDong = await nem(() => cong2.qua(async () => { soLanChay++; return { code: 0 } }))
        ca('A3b. gọi mới trong 60 s nghỉ ⇒ ném ngay, không gửi', cg.laLoiTikTokGioiHan(loiDong) && loiDong.chuaGui === true && soLanChay === 1)

        // A4: hết nghỉ ⇒ mở lại
        nay += 60_001
        const sauNghi = await cong2.qua(async () => { soLanChay++; return { code: 0, ok: 1 } })
        ca('A4. hết 60 s nghỉ ⇒ cổng mở lại, lời gọi chạy bình thường', (sauNghi as any).ok === 1 && !cong2.dangDong() && soLanChay === 2)

        // A5: mã lỗi khác ⇒ trả nguyên, cổng vẫn mở (ca phải im)
        const cong3 = taoCong()
        const r5 = await cong3.qua(async () => ({ code: 36009004, message: 'invalid' }))
        ca('A5. mã lỗi khác (36009004) ⇒ trả nguyên phản hồi, cổng KHÔNG đóng, không đếm bị chặn',
            (r5 as any).code === 36009004 && !cong3.dangDong() && cong3.soLanBiChan() === 0)

        // A6: lỗi mạng ⇒ ném nguyên, hàng không gãy
        const loi6 = await nem(() => cong3.qua(async () => { throw new Error('fetch failed') }))
        const sau6 = await cong3.qua(async () => ({ code: 0, sau: 1 }))
        ca('A6. lỗi mạng ⇒ ném NGUYÊN (không phải lỗi hạn mức), cổng mở, lời gọi kế vẫn chạy',
            loi6?.message === 'fetch failed' && !cg.laLoiTikTokGioiHan(loi6) && !cong3.dangDong() && (sau6 as any).sau === 1)

        // A7: HTTP 429 (phản hồi không phải JSON) ⇒ đóng cổng
        const loi7 = await nem(() => cong3.qua(async () => { throw new Error('HTTP 429 Too Many Requests: <html>') }))
        ca('A7. HTTP 429 ⇒ LoiTikTokGioiHan + đóng cổng', cg.laLoiTikTokGioiHan(loi7) && cong3.dangDong())

        // A8: chờ trong hàng quá lâu ⇒ bỏ, không chạy (URL đã ký kèm timestamp)
        const cong4 = taoCong(1000)
        let chay8 = 0
        const kq8 = await Promise.allSettled([0, 1, 2, 3].map(() => cong4.qua(async () => { chay8++; nay += 500; return { code: 0 } })))
        const tt8 = kq8.map(r => r.status === 'fulfilled' ? 'ok' : ((r as any).reason?.chuaGui ? 'bo' : 'loi'))
        ca('A8. chờ quá choToiDaMs ⇒ ném (chuaGui), KHÔNG gửi; lời gọi kịp lượt vẫn chạy', chay8 === 2 && tt8.join() === 'ok,ok,bo,bo', JSON.stringify({ chay8, tt8 }))

        ca('A9. laLoiTikTokGioiHan: chỉ nhận đúng lỗi của cổng — lỗi thường có chữ 36009002 thì KHÔNG (ca phải im)',
            cg.laLoiTikTokGioiHan(new cg.LoiTikTokGioiHan(nay, true)) && !cg.laLoiTikTokGioiHan(new Error('[36009002] Too many requests'))
            && !cg.laLoiTikTokGioiHan(null) && !cg.laLoiTikTokGioiHan('x'))
        ca('A10. laDuongTaiChinhTikTok: /finance/* có, /order/* và URL hỏng không',
            cg.laDuongTaiChinhTikTok('https://open-api.tiktokglobalshop.com/finance/202309/orders/1/statement_transactions?a=1')
            && !cg.laDuongTaiChinhTikTok('https://open-api.tiktokglobalshop.com/order/202309/orders?ids=1')
            && !cg.laDuongTaiChinhTikTok('không phải url'))
    }

    // ─── B. TikTokService với fetch giả ──────────────────────────────────────────────
    {
        const fetchGoc = globalThis.fetch
        let dangTC = 0, dinhTC = 0, dangKhac = 0, dinhKhac = 0, soGoiTC = 0
        const batDauTC: number[] = []
        let traTC: () => any = () => ({ code: 0, data: { statement_transactions: [{ settlement_amount: '400000', revenue_amount: '600000', fee_amount: '-200000' }] } })
        ;(globalThis as any).fetch = async (url: string) => {
            const laTC = new URL(url).pathname.startsWith('/finance/')
            if (laTC) { soGoiTC++; dangTC++; dinhTC = Math.max(dinhTC, dangTC); batDauTC.push(Date.now()) } else { dangKhac++; dinhKhac = Math.max(dinhKhac, dangKhac) }
            await nguThat(15)
            const than = laTC ? traTC() : { code: 0, data: { orders: [] } }
            if (laTC) dangTC--; else dangKhac--
            return new Response(JSON.stringify(than), { status: 200 })
        }
        try {
            imLog()
            const svc: any = new TikTokService({ apiKey: 'k', apiSecret: 's', accessToken: 'tk-gia', shopId: 'c1' } as any)
            const r = await Promise.all([1, 2, 3, 4].map(i => svc.getOrderSettlement(`O${i}`)))
            const cachTC = batDauTC.slice(1).map((t, i) => t - batDauTC[i])
            await Promise.all([1, 2, 3, 4].map(() => svc.goiTho('GET', '/order/202309/orders', { ids: '1' })))
            moLog()
            ca('B1. getOrderSettlement ×4 cùng lúc ⇒ đi qua cổng: tối đa 1 lời gọi tài chính, cách ≥ 25 ms; số đọc đúng',
                dinhTC === 1 && soGoiTC === 4 && cachTC.every(c => c >= 24) && r.every(x => x?.settlementAmount === 400000 && x?.feeAmount === 200000),
                JSON.stringify({ dinhTC, soGoiTC, cachTC }))
            ca('B2. đường KHÔNG phải tài chính (/order/*) đi thẳng, vẫn song song như cũ', dinhKhac === 4, `dinhKhac=${dinhKhac}`)

            // B3: bị chặn ⇒ một lời gọi thật, ba lời gọi đang chờ không gửi; getOrderSettlement NÉM (không null)
            soGoiTC = 0
            traTC = () => ({ code: 36009002, message: 'shared app-group rate limit' })
            imLog()
            const kq3 = await Promise.allSettled([1, 2, 3, 4].map(i => svc.getOrderSettlement(`P${i}`)))
            moLog()
            const loi3 = kq3.map(x => x.status === 'rejected' ? (x as any).reason : x)
            ca('B3. TikTok bóp hạn mức ⇒ cả 4 NÉM LoiTikTokGioiHan (không còn null = "chưa có số"); chỉ 1 lời gọi tới TikTok',
                loi3.every(e => cg.laLoiTikTokGioiHan(e)) && soGoiTC === 1 && cg.congTaiChinhTikTok.dangDong(),
                JSON.stringify({ soGoiTC, loai: loi3.map(e => e?.name || typeof e) }))
            await nguThat(320)
            traTC = () => ({ code: 36009004, message: 'order not settled' })
            imLog()
            const r4 = await svc.getOrderSettlement('Q1')
            moLog()
            ca('B4. hết nghỉ ⇒ gọi lại được; mã lỗi khác (chưa quyết toán) ⇒ null như cũ (ca phải im)',
                r4 === null && !cg.congTaiChinhTikTok.dangDong() && soGoiTC === 2)
        } finally {
            moLog()
            ;(globalThis as any).fetch = fetchGoc
        }
    }

    // ─── C. buHoaHongAffiliate: bị chặn ⇒ dừng kênh, không nghỉ 24 giờ ────────────────
    {
        const don = Array.from({ length: 10 }, (_, i) => ({ id: `cc${i}`, externalOrderId: `TIK-77${i}` }))
        const spGia = () => {
            const ghi: any[] = []
            return { ghi, sp: { onlineOrder: {
                findMany: async (a: any) => { const bo = new Set(a?.where?.id?.notIn || []); return don.filter(d => !bo.has(d.id)) },
                update: async (a: any) => { ghi.push(a) },
            } } }
        }
        let goi: string[] = []
        let cheDo: 'chan' | 'thuong' = 'chan'
        class TTGia {
            constructor(_c: any) { }
            async getOrderSettlement(sn: string) {
                goi.push(sn)
                if (cheDo === 'chan' && goi.length >= 2) throw new cg.LoiTikTokGioiHan(Date.now() + 60_000, goi.length > 2)
                return { settlementAmount: 1, feeAmount: 1, revenueAmount: 2, affiliateFee: 0 }
            }
        }
        class SPGia { constructor(_c: any) { } async getEscrowDetail() { throw new Error('không được gọi Shopee') } }
        const ch = { id: 'chC', name: 'Gian C', platform: 'tiktok', apiKey: 'k', apiSecret: 's', accessToken: 't', shopId: '1' }
        const b1 = spGia()
        imLog(); canhBao = []
        const logLuot: string[] = []
        console.log = (...a: any[]) => { logLuot.push(a.join(' ')) }
        const n1 = await buHoaHongAffiliate(b1.sp, ch, Date.now() + 60_000, mapWithConcurrency, SPGia, TTGia)
        moLog()
        const soGoi1 = goi.length
        goi = []; cheDo = 'thuong'
        const b2 = spGia()
        imLog()
        const n2 = await buHoaHongAffiliate(b2.sp, ch, Date.now() + 60_000, mapWithConcurrency, SPGia, TTGia)
        moLog()
        ca('C1. bị TikTok chặn ⇒ dừng kênh: ≤ 3 lời gọi / 10 đơn, ghi đúng đơn đã đọc được, log nói rõ "bóp hạn mức"',
            n1 === 1 && soGoi1 >= 2 && soGoi1 <= 3 && b1.ghi.length === 1 && logLuot.some(l => /bóp hạn mức/.test(l)),
            JSON.stringify({ n1, soGoi1, ghi: b1.ghi.length, log: logLuot }))
        ca('C2. đơn bị chặn / chưa hỏi KHÔNG bị nghỉ 24 giờ ⇒ lượt sau hỏi lại ĐỦ 10 đơn (đơn đọc được rồi cũng chỉ bị hỏi lại vì CSDL giả)',
            n2 === 10 && goi.length === 10, JSON.stringify({ n2, hoiLai: goi.length }))
    }

    // ─── D. Dò kênh webhook — registry giả ──────────────────────────────────────────
    {
        type CuaHangGia = { schema: string; code: string; bang?: string[]; cot?: Record<string, string[]>; co?: Record<string, string[]> }
        const taoDb = (cuaHang: CuaHangGia[], hongUnion?: () => any) => {
            const dem = { catalog: 0, stores: 0, union: 0 }
            const sqlUnion: string[] = []
            const thamSoUnion: any[][] = []
            const db: any = {
                $queryRawUnsafe: async (sql: string, ...values: any[]) => {
                    await nguThat(5)
                    if (/pg_catalog\.pg_class/.test(sql)) {
                        dem.catalog++
                        const [bang, cot] = values as [string, string[]]
                        const ra: Array<{ s: string; c: string }> = []
                        for (const ch of cuaHang) {
                            const coBang = !!ch.cot?.[bang] || (ch.bang ?? ['OnlineChannel', 'FbPage']).includes(bang)
                            const cotCo = !coBang ? [] : (ch.cot?.[bang] ?? (bang === 'FbPage' ? ['pageId'] : ['platform', 'shopId', 'platformShopId']))
                            for (const c of cotCo) if (cot.includes(c)) ra.push({ s: ch.schema, c })
                        }
                        return ra
                    }
                    dem.union++
                    sqlUnion.push(sql); thamSoUnion.push(values)
                    if (hongUnion) { const e = hongUnion(); if (e) throw e }
                    const ra: Array<{ thu_tu: number }> = []
                    for (const m of sql.matchAll(/\(SELECT (\d+) AS thu_tu FROM "([^"]+)"\."([^"]+)" WHERE ([^\n]*?) LIMIT 1\)/g)) {
                        const [, i, schema, bang] = m
                        const ch = cuaHang.find(c => c.schema === schema)
                        if (ch?.co?.[bang]?.includes(String(values[0]))) ra.push({ thu_tu: Number(i) })
                    }
                    return ra
                },
                store: { findMany: async () => { dem.stores++; await nguThat(2); return cuaHang.map(c => ({ schema: c.schema, code: c.code })) } },
            }
            return { db, dem, sqlUnion, thamSoUnion }
        }
        const ds: CuaHangGia[] = [
            { schema: 'store_a', code: 'A', co: { OnlineChannel: ['111'] } },
            { schema: 'store_b', code: 'B', co: { OnlineChannel: ['222', '777'], FbPage: ['PG1'] } },
            { schema: 'store_c', code: 'C', co: { OnlineChannel: ['777'] } },
        ]

        // D1: 60 push cùng shop, bản lạnh ⇒ MỘT lượt dò
        tk._datLaiDoKenh(); imLog()
        const g1 = taoDb(ds)
        const ra1 = await Promise.all(Array.from({ length: 60 }, () => tk.timSchemaKenh('shopee', '222', g1.db)))
        moLog()
        const t1 = tk.thongKeDoKenh()
        ca('D1. 60 push cùng shop cùng lúc trên bản lạnh ⇒ ĐÚNG MỘT lượt dò (1 catalog + 1 danh sách cửa hàng + 1 UNION), cả 60 ra store_b',
            ra1.every(s => s === 'store_b') && g1.dem.catalog === 1 && g1.dem.stores === 1 && g1.dem.union === 1 && t1.soLanDo === 1 && t1.soLanGop === 59,
            JSON.stringify({ dem: g1.dem, t1 }))
        // D2: trúng đệm ⇒ 0 truy vấn
        const ra2 = await tk.timSchemaKenh('shopee', '222', g1.db)
        ca('D2. push sau (trong 6 giờ) ⇒ trúng đệm, KHÔNG truy vấn gì', ra2 === 'store_b' && g1.dem.union === 1 && g1.dem.catalog === 1)

        // D3: thứ tự như cũ + cảnh báo trùng một lần
        imLog(); canhBao = []
        const ra3 = await tk.timSchemaKenh('shopee', '777', g1.db)
        tk.boDemKenh('shopee', '777')
        await tk.timSchemaKenh('shopee', '777', g1.db)
        moLog()
        ca('D3. shop có ở hai cửa hàng ⇒ ra cửa hàng ĐỨNG TRƯỚC (thứ tự store.findMany như cũ) + MỘT dòng cảnh báo dù dò lại',
            ra3 === 'store_b' && canhBao.filter(l => /777/.test(l) && /B, C/.test(l)).length === 1, JSON.stringify(canhBao))

        // D4: không có ⇒ null, KHÔNG đệm "không có"
        imLog()
        const truoc4 = g1.dem.union
        const ra4a = await tk.timSchemaKenh('shopee', '999', g1.db)
        const ra4b = await tk.timSchemaKenh('shopee', '999', g1.db)
        moLog()
        ca('D4. shop không thuộc cửa hàng nào ⇒ null, và KHÔNG nhớ "không có" (cửa hàng vừa nối sàn phải nhận push ngay)',
            ra4a === null && ra4b === null && g1.dem.union === truoc4 + 2)

        // D5: đọc hỏng ⇒ mọi push chờ chung nhận lỗi, không đệm; lần sau dò lại
        tk._datLaiDoKenh(); imLog()
        let hongNua = true
        const g5 = taoDb(ds, () => hongNua ? Object.assign(new Error("Can't reach database server"), { code: 'P1001' }) : null)
        const kq5 = await Promise.allSettled(Array.from({ length: 20 }, () => tk.timSchemaKenh('shopee', '111', g5.db)))
        hongNua = false
        const ra5 = await tk.timSchemaKenh('shopee', '111', g5.db)
        moLog()
        ca('D5. đọc hỏng (P1001) ⇒ cả 20 push chờ chung NHẬN LỖI (hộp thư thử lại), một lượt dò; không đệm ⇒ lần sau dò lại ra đúng',
            kq5.every(r => r.status === 'rejected' && (r as any).reason?.code === 'P1001') && g5.dem.union === 2 && ra5 === 'store_a',
            JSON.stringify({ union: g5.dem.union, ra5 }))

        // D6–D8: TikTok thiếu cột, bảng thiếu, tên schema lạ, shop_id chỉ là tham số
        tk._datLaiDoKenh(); imLog()
        const dsTT: CuaHangGia[] = [
            { schema: 'store_a', code: 'A', cot: { OnlineChannel: ['platform', 'shopId', 'platformShopId'] }, co: { OnlineChannel: [] } },
            { schema: 'store_cu', code: 'CU', cot: { OnlineChannel: ['platform', 'shopId'] }, co: { OnlineChannel: [] } },
            { schema: 'store_khong_bang', code: 'KB', bang: [], co: {} },
            { schema: 'la"; DROP SCHEMA x; --', code: 'LA', co: { OnlineChannel: ["9'9;--"] } },
            { schema: 'store_d', code: 'D', co: { OnlineChannel: ["9'9;--"] } },
        ]
        const g6 = taoDb(dsTT)
        const ra6 = await tk.timSchemaKenh('tiktok', "9'9;--", g6.db)
        moLog()
        const sql6 = g6.sqlUnion[0] || ''
        const phanA = sql6.split('UNION ALL').find(p => /"store_a"/.test(p)) || ''
        const phanCu = sql6.split('UNION ALL').find(p => /"store_cu"/.test(p)) || ''
        ca('D6. TikTok: cửa hàng CÓ cột platformShopId dò cả hai cột; cửa hàng cũ thiếu cột dò bằng shopId (không vỡ cả câu)',
            /"shopId" = \$1 OR "platformShopId" = \$1/.test(phanA) && /"shopId" = \$1/.test(phanCu) && !/platformShopId/.test(phanCu), sql6)
        ca('D7. cửa hàng thiếu bảng và tên schema lạ bị BỎ khỏi câu dò', !/store_khong_bang/.test(sql6) && !/DROP/.test(sql6) && ra6 === 'store_d', JSON.stringify({ ra6 }))
        ca('D8. shop_id chỉ đi qua tham số $1, không bao giờ nằm trong chuỗi SQL', !sql6.includes("9'9") && g6.thamSoUnion[0]?.[0] === "9'9;--")

        // D9: đệm trỏ sai ⇒ bỏ đệm, dò lại MỘT lần
        tk._datLaiDoKenh(); imLog()
        const dsCu: CuaHangGia[] = [
            { schema: 'store_a', code: 'A', co: { OnlineChannel: ['555'] } },
            { schema: 'store_b', code: 'B', co: { OnlineChannel: [] } },
        ]
        const g9 = taoDb(dsCu)
        await tk.timSchemaKenh('shopee', '555', g9.db)              // đệm: store_a
        dsCu[0].co = { OnlineChannel: [] }; dsCu[1].co = { OnlineChannel: ['555'] }   // kênh chuyển sang store_b
        const docQua: string[] = []
        const ra9 = await tk.timKenhVaBanGhi('shopee', '555', async s => { docQua.push(s); return s === 'store_b' ? { id: 'k1' } : null }, g9.db)
        // kênh bị gỡ hẳn nhưng registry (đọc chậm) vẫn trỏ store_b ⇒ không lặp vô hạn
        dsCu[1].co = { OnlineChannel: ['555'] }
        const docQua2: string[] = []
        const ra9b = await tk.timKenhVaBanGhi('shopee', '555', async s => { docQua2.push(s); return null }, g9.db)
        moLog()
        ca('D9. đệm trỏ cửa hàng cũ (kênh đã chuyển) ⇒ bỏ đệm, dò lại MỘT lần, ra cửa hàng mới',
            ra9?.schema === 'store_b' && (ra9?.banGhi as any)?.id === 'k1' && docQua.join() === 'store_a,store_b', JSON.stringify({ ra9, docQua }))
        ca('D9b. dò lại vẫn ra đúng cửa hàng mà không đọc được kênh ⇒ null, KHÔNG lặp (đọc ≤ 2 lần)',
            ra9b === null && docQua2.length <= 2, JSON.stringify(docQua2))

        // D10: Facebook dò bảng FbPage theo pageId
        tk._datLaiDoKenh(); imLog()
        const g10 = taoDb(ds)
        const ra10 = await tk.timSchemaKenh('facebook', 'PG1', g10.db)
        moLog()
        ca('D10. Facebook: dò bảng FbPage theo "pageId" = $1', ra10 === 'store_b' && /"FbPage" WHERE "pageId" = \$1/.test(g10.sqlUnion[0] || ''), g10.sqlUnion[0])
        tk._datLaiDoKenh()
    }

    // ─── E. Nối dây ─────────────────────────────────────────────────────────────────
    {
        const wh = doc('src/routes/webhooks.ts')
        ca('E1. webhooks.ts: Shopee / TikTok / Facebook dò qua timKenhVaBanGhi, KHÔNG còn tự quét store.findMany',
            /timKenhVaBanGhi\('shopee'/.test(wh) && /timKenhVaBanGhi\('tiktok'/.test(wh) && /timKenhVaBanGhi\('facebook'/.test(wh)
            && !/registryPrisma\.store\.findMany/.test(wh))
        const tt = doc('src/services/platforms/tiktok.ts')
        ca('E2. TikTokService: httpGet + httpPost đưa /finance/* qua congTaiChinhTikTok',
            /laDuongTaiChinhTikTok\(url\)\) return super\.httpGet/.test(tt) && /congTaiChinhTikTok\.qua\(\(\) => super\.httpGet/.test(tt)
            && /congTaiChinhTikTok\.qua\(\(\) => super\.httpPost/.test(tt))
        const as = doc('src/cron/autoSync.ts')
        ca('E3. FeeSync: bị chặn đếm riêng "để lượt sau", thôi TikTok tới hết lượt, bỏ nghỉ 350 ms cũ (cổng giữ nhịp)',
            /if \(laLoiTikTokGioiHan\(e\)\) \{ deLai\+\+; return \}/.test(as) && /tikTokBiChanLuotNay\(\)\) \{ kenhTikTokBoQua\+\+; continue \}/.test(as)
            && !/setTimeout\(r, 350\)/.test(as))
        const oo = doc('src/routes/onlineOrders.ts')
        ca('E4. nút "Lấy phí": bị chặn đếm riêng (không lẫn "chưa quyết toán"), có hạn giờ cho TikTok',
            /if \(laLoiTikTokGioiHan\(e\)\) \{ biChan\+\+; return \}/.test(oo) && /HAN_TIKTOK_MS/.test(oo))
        const ad = doc('src/routes/admin.ts')
        ca('E5. trang soát admin: lỗi cổng tính vào biChanTocDo', /if \(laLoiTikTokGioiHan\(e\)\) \{ k\.biChanTocDo\+\+ \}/.test(ad))
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    process.exit(hong ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
