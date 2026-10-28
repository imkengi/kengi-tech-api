/**
 * Kiểm KẾT NỐI meInvoice + KHỚP HOÁ ĐƠN ↔ KHÁCH — npx tsx scripts/check-me-invoice.ts
 *
 * Chủ shop 28/10/2026: gửi hoá đơn MISA cho khách qua nhóm Zalo — "chỉ hoá đơn khách gõ /hoadon thôi", "hoặc khách lấy định kỳ".
 * Lõi: lib/meInvoice.ts (đăng nhập, đọc trả về, đọc hoá đơn), lib/hoaDonMisaZalo.ts (khớp), routes/meInvoice.ts.
 * Sai ở đây là gửi hoá đơn của khách này vào nhóm khách kia, gửi hoá đơn khách không xin, hay lộ mật khẩu meInvoice
 * ra màn hình — nên mỗi thứ một ca. Chưa có tài khoản thật: MISA giả dựng đúng hình tài liệu developer.misa.vn (28/10/2026).
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import fs from 'fs'
import path from 'path'
import {
    docTruong, docTraVe, moTaLoi, tachToken, ngayHoaDon, docHoaDon, tachDanhSach, congHopLe, moTaKetNoi, mstChuan,
    luuKetNoi, docKetNoi, thuKetNoi, goiApi, dsHoaDonWeb, LoiMeInvoice, CONG_MAC_DINH, type KetNoiMeInvoice, type HoaDonMisa,
} from '../src/lib/meInvoice'
import { quyetDinh, timKhach, phieuTrongCuaSo, CUA_SO_NGAY, type BangKhach, type PhieuLayHd, type NhomZalo } from '../src/lib/hoaDonMisaZalo'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
async function nem(fn: () => Promise<any>): Promise<string> {
    try { await fn(); return '' } catch (e: any) { return String(e?.message || e) }
}

/** prisma giả: một dòng MeInvoiceKetNoi + bảng nối AMIS */
function spGia() {
    let dong: any = null
    const sp: any = {
        __schema: 'kiem_tra',
        misaConfig: { findUnique: async () => ({ clientId: 'AMIS-CLIENT', clientSecret: 'AMIS-SECRET' }) },
        async $queryRawUnsafe(sql: string) {
            if (/^SELECT \* FROM "MeInvoiceKetNoi"/.test(sql)) return dong ? [{ ...dong }] : []
            throw new Error('SQL lạ: ' + sql)
        },
        async $executeRawUnsafe(sql: string, ...p: any[]) {
            const s = sql.replace(/\s+/g, ' ').trim()
            if (s.startsWith('CREATE TABLE')) return 0
            if (s.startsWith('INSERT INTO "MeInvoiceKetNoi"')) {
                const [id, dungChungAmis, clientId, clientSecret, mst, taiKhoan, matKhau, coMa, congRieng, nguoiLuu, capNhatLuc] = p
                dong = { ...(dong || {}), id, dungChungAmis, clientId, clientSecret, mst, taiKhoan, matKhau, coMa, congRieng, nguoiLuu, capNhatLuc }
                return 1
            }
            if (s.startsWith('DELETE')) { const co = !!dong; dong = null; return co ? 1 : 0 }
            if (s.startsWith('UPDATE "MeInvoiceKetNoi" SET "thuLuc"')) { dong.thuLuc = p[1]; dong.thuKetQua = p[2]; return 1 }
            if (/SET "tokenTichHop" = \$2, "hanTichHop" = \$3/.test(s)) { dong.tokenTichHop = p[1]; dong.hanTichHop = p[2]; return 1 }
            if (/SET "tokenWeb" = \$2, "hanWeb" = \$3/.test(s)) { dong.tokenWeb = p[1]; dong.hanWeb = p[2]; return 1 }
            if (/SET .*=NULL/.test(s)) {
                if (s.includes('"tokenTichHop"=NULL')) { dong.tokenTichHop = null; dong.hanTichHop = null }
                if (s.includes('"tokenWeb"=NULL')) { dong.tokenWeb = null; dong.hanWeb = null }
                return 1
            }
            throw new Error('SQL lạ: ' + s)
        },
        dong: () => dong,
    }
    return sp
}

/** MISA giả qua global.fetch — ghi lại mọi lời gọi */
type Goi = { url: string; method: string; headers: Record<string, string>; body: any }
function misaGia(xuLy: (g: Goi, lan: number) => { status?: number; json?: any; text?: string }) {
    const goi: Goi[] = []
    ;(globalThis as any).fetch = async (url: string, init: any) => {
        const g: Goi = { url, method: init?.method || 'GET', headers: init?.headers || {}, body: init?.body ? JSON.parse(init.body) : undefined }
        goi.push(g)
        const r = xuLy(g, goi.length)
        const text = r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : '')
        return { status: r.status ?? 200, text: async () => text } as any
    }
    return goi
}

async function main() {
    console.log('\n▶ meInvoice — kết nối, đọc hoá đơn, khớp khách để gửi Zalo\n')

    /* 1 — Đọc trả về của MISA (hai kiểu chữ hoa/thường, lỗi cổng, chuỗi JSON) */
    {
        let t = docTraVe(200, { success: true, errorCode: null, data: 'TOKEN' }, '')
        ok('1a. {success,data} chữ thường ⇒ ok, data nguyên', t.ok && t.data === 'TOKEN', t)
        t = docTraVe(200, { Success: true, ErrorCode: null, Data: 'TOKEN' }, '')
        ok('1b. {Success,Data} chữ hoa đầu (API token) ⇒ ok', t.ok && t.data === 'TOKEN', t)
        t = docTraVe(200, { success: false, errorCode: 'InvalidUser', descriptionErrorCode: 'Sai tài khoản hoặc mật khẩu' }, '')
        ok('1c. success=false ⇒ lỗi giữ NGUYÊN mã + mô tả của MISA', !t.ok && t.loi.includes('InvalidUser') && t.loi.includes('Sai tài khoản hoặc mật khẩu'), t)
        t = docTraVe(401, { statusCode: 401, message: 'Access denied due to invalid subscription key.' }, '')
        ok('1d. Lỗi CỔNG (sai ClientID) ⇒ hiện câu của cổng', !t.ok && t.loi.includes('invalid subscription key'), t)
        t = docTraVe(502, null, '  <html>Bad Gateway</html> ')
        ok('1e. Không phải JSON ⇒ lỗi là chữ thô đã cắt gọn', !t.ok && t.loi === '<html>Bad Gateway</html>', t)
        t = docTraVe(200, { success: true, data: '[{"InvNo":"0001"}]' }, '')
        ok('1f. data là CHUỖI JSON ⇒ mở thành mảng', Array.isArray(t.data) && t.data[0].InvNo === '0001', t)
        t = docTraVe(200, { success: false, errors: ['Lỗi A', { Message: 'Lỗi B' }], Error: 'X', ErrorDescription: 'Mô tả X' }, '')
        ok('1g. errors mảng + Error/ErrorDescription (web app) ⇒ gom đủ, không trùng', ['Lỗi A', 'Lỗi B', 'X', 'Mô tả X'].every(s => t.loi.includes(s)), t)
        t = docTraVe(200, { success: true, data: null }, '')
        ok('1h. success=true mà data null ⇒ vẫn ok (không đoán lỗi)', t.ok && t.loi === '', t)
        ok('1i. docTruong không phân biệt hoa thường', docTruong({ totalamount: 5 }, 'TotalAmount') === 5)
        ok('1j. moTaLoi rỗng khi không có lỗi', moTaLoi({ success: true }) === '')
    }

    /* 2 — Token: chuỗi (tích hợp) hay object (web app) */
    {
        let k = tachToken('abc.def')
        ok('2a. data chuỗi ⇒ token, không có hạn', k.token === 'abc.def' && k.songMs === null, k)
        k = tachToken({ access_token: 'WEB', expires_in: 3600 })
        ok('2b. data object {access_token, expires_in} ⇒ token + hạn 1 giờ', k.token === 'WEB' && k.songMs === 3_600_000, k)
        k = tachToken({ Token: 'T2' })
        ok('2c. {Token} ⇒ đọc được', k.token === 'T2', k)
        k = tachToken({ khac: 1 })
        ok('2d. object không có token ⇒ rỗng (đăng nhập báo lỗi, không coi là xong)', k.token === '', k)
    }

    /* 3 — Ngày hoá đơn theo giờ VN */
    {
        ok('3a. "…T00:00:00+07:00" ⇒ đúng ngày', ngayHoaDon('2026-10-28T00:00:00+07:00') === '2026-10-28')
        ok('3b. "YYYY-MM-DD" ⇒ giữ', ngayHoaDon('2026-10-28') === '2026-10-28')
        ok('3c. Giờ UTC 17:30Z ⇒ sang ngày hôm sau giờ VN (không lùi một ngày)', ngayHoaDon('2026-10-27T17:30:00Z') === '2026-10-28', ngayHoaDon('2026-10-27T17:30:00Z'))
        ok('3d. Không múi giờ ⇒ lấy ngày ghi', ngayHoaDon('2026-10-28T08:15:00') === '2026-10-28')
        ok('3e. Rác / trống ⇒ null', ngayHoaDon('abc') === null && ngayHoaDon(null) === null)
    }

    /* 4 — Đọc một hoá đơn trên web app (hình theo ví dụ /invoiceweb/insert của tài liệu) */
    {
        const h = docHoaDon({
            RefID: 'r-1', InvSeries: '1C26TAA', InvNo: '00000123', InvDate: '2026-10-28T00:00:00+07:00',
            AccountObjectCode: 'HN17', AccountObjectTaxCode: '0312 345 678', AccountObjectName: 'Công ty A', TotalAmount: 1_080_000,
            TransactionID: '44C_T5_4MR9P', PublishStatus: 6,
        })
        ok('4a. Đủ trường: ký hiệu, số, ngày, mã khách, MST chuẩn hoá, tổng, mã tra cứu',
            h.kyHieu === '1C26TAA' && h.so === '00000123' && h.ngay === '2026-10-28' && h.maKhach === 'HN17' && h.mst === '0312345678'
            && h.tongTien === 1_080_000 && h.maTraCuu === '44C_T5_4MR9P' && h.trangThai === '6', h)
        const nhap = docHoaDon({ InvNo: '<Chưa cấp số>', AccountObjectTaxCode: '123', TotalAmountOC: '542000' })
        ok('4b. "<Chưa cấp số>" ⇒ số null; MST sai ⇒ rỗng; tổng dạng chuỗi ⇒ số', nhap.so === null && nhap.mst === '' && nhap.tongTien === 542000, nhap)
        const thuong = docHoaDon({ invno: '7', accountobjectcode: 'kh1', buyertaxcode: '0101234567-001' })
        ok('4c. Khoá chữ thường / tên kiểu phát hành (BuyerTaxCode) ⇒ vẫn đọc, MST chi nhánh hợp lệ', thuong.so === '7' && thuong.maKhach === 'kh1' && thuong.mst === '0101234567-001', thuong)
        ok('4d. mstChuan: 12 số (CCCD) hợp lệ, 9 số không', mstChuan('012345678901') === '012345678901' && mstChuan('123456789') === '')
    }

    /* 5 — Danh sách trong data (mảng / bọc / chuỗi) */
    {
        ok('5a. Mảng thẳng', tachDanhSach([{ a: 1 }]).ds.length === 1)
        const b = tachDanhSach({ Items: [{ a: 1 }, { a: 2 }], Total: 9 })
        ok('5b. {Items, Total}', b.ds.length === 2 && b.tong === 9, b)
        ok('5c. Chuỗi JSON mảng', tachDanhSach('[{"a":1},{"a":2},{"a":3}]').ds.length === 3)
        ok('5d. {Data:"[…]"} lồng chuỗi', tachDanhSach({ Data: '[{"a":1}]' }).ds.length === 1)
        ok('5e. Rác ⇒ rỗng, không nổ', tachDanhSach('lỗi gì đó').ds.length === 0 && tachDanhSach(null).ds.length === 0)
    }

    /* 6 — Cổng tự đặt: chỉ https *.misa.vn / *.meinvoice.vn (chặn SSRF) */
    {
        ok('6a. Cổng chuẩn (bỏ / cuối)', congHopLe('https://developer.misa.vn/apis/itg/meinvoice/') === 'https://developer.misa.vn/apis/itg/meinvoice')
        ok('6b. http ⇒ chặn', congHopLe('http://developer.misa.vn/apis') === null)
        ok('6c. Tên miền lạ ⇒ chặn', congHopLe('https://evil.com/misa.vn') === null && congHopLe('https://misa.vn.evil.com') === null)
        ok('6d. *.meinvoice.vn ⇒ nhận', congHopLe('https://api.meinvoice.vn/api') === 'https://api.meinvoice.vn/api')
        ok('6e. Mặc định đúng base URL tài liệu', CONG_MAC_DINH === 'https://developer.misa.vn/apis/itg/meinvoice')
    }

    /* 7 — Lưu kết nối: mã hoá bí mật, để trống = giữ, màn hình không lộ gì */
    {
        const sp = spGia()
        let loi = await nem(() => luuKetNoi(sp, { clientId: 'CID-1234567890-abcdef', clientSecret: 'S3CR3T', mst: '0312345678', taiKhoan: 'kt@hungtin.vn' }, 'chu'))
        ok('7a. Lần đầu thiếu mật khẩu ⇒ từ chối, nói rõ', loi.includes('Thiếu mật khẩu'), loi)
        loi = await nem(() => luuKetNoi(sp, { clientId: 'CID', clientSecret: 'S', mst: '031234567', taiKhoan: 'a', matKhau: 'p' }, 'chu'))
        ok('7b. MST người bán 9 số ⇒ từ chối', loi.includes('MST người bán'), loi)
        loi = await nem(() => luuKetNoi(sp, { mst: '0312345678', taiKhoan: 'a', matKhau: 'p' }, 'chu'))
        ok('7c. Không dùng chung AMIS mà thiếu ClientID ⇒ từ chối', loi.includes('Thiếu ClientID'), loi)
        loi = await nem(() => luuKetNoi(sp, { clientId: 'CID-1234567890-abcdef', clientSecret: 'S3CR3T', mst: '0312345678', taiKhoan: 'kt@hungtin.vn', matKhau: 'P@ssw0rd!' }, 'chu'))
        ok('7d. Đủ thông tin ⇒ lưu được', loi === '', loi)
        const dong = sp.dong()
        ok('7e. Client Secret + mật khẩu nằm trong DB ĐÃ MÃ HOÁ', dong.clientSecret !== 'S3CR3T' && dong.matKhau !== 'P@ssw0rd!' && dong.clientSecret.split('.').length === 3)
        await luuKetNoi(sp, { clientId: '', clientSecret: '', mst: '0312345678', taiKhoan: 'kt@hungtin.vn', matKhau: '', coMa: false }, 'chu')
        const kn = (await docKetNoi(sp))!
        ok('7f. Lưu lại với ô bí mật trống ⇒ giữ nguyên bản cũ (giải mã ra đúng)', kn.clientSecret === 'S3CR3T' && kn.matKhau === 'P@ssw0rd!' && kn.clientId === 'CID-1234567890-abcdef' && kn.coMa === false, { ...kn, matKhau: '…', clientSecret: '…' })
        const kn2: KetNoiMeInvoice = { ...kn, tokenTichHop: 'TOKEN-TICH-HOP', hanTichHop: Date.now() + 1e6, tokenWeb: 'TOKEN-WEB', hanWeb: Date.now() - 1 }
        const man = JSON.stringify(moTaKetNoi(kn2))
        ok('7g. Màn hình KHÔNG có Client Secret / mật khẩu / token / ClientID đầy đủ', !['S3CR3T', 'P@ssw0rd!', 'TOKEN-TICH-HOP', 'TOKEN-WEB', 'CID-1234567890-abcdef'].some(s => man.includes(s)), man)
        const mo: any = moTaKetNoi(kn2)
        ok('7h. Màn hình báo token còn/hết hạn đúng', mo.tokenTichHopCon === true && mo.tokenWebCon === false && mo.coClientSecret === true, mo)
        await luuKetNoi(sp, { dungChungAmis: true, mst: '0312345678', taiKhoan: 'kt@hungtin.vn' }, 'chu')
        const kn3 = (await docKetNoi(sp))!
        ok('7i. "Dùng chung với AMIS" ⇒ lấy ClientID/Secret của kết nối AMIS lúc gọi', kn3.clientId === 'AMIS-CLIENT' && kn3.clientSecret === 'AMIS-SECRET')
        loi = await nem(() => luuKetNoi(sp, { congRieng: 'https://evil.com' }, 'chu'))
        ok('7j. Cổng riêng ngoài misa.vn ⇒ từ chối', loi.includes('misa.vn'), loi)
    }

    /* 8 — Gọi MISA giả: đúng header + tên trường từng đường đăng nhập, đăng nhập lại khi token bị từ chối */
    {
        const sp = spGia()
        await luuKetNoi(sp, { clientId: 'CID-9', clientSecret: 'SEC-9', mst: '0312345678', taiKhoan: 'kt@hungtin.vn', matKhau: 'mk9' }, 'chu')
        let dongPaging = 0
        const goi = misaGia((g) => {
            if (g.url.endsWith('/invoice/token')) return { json: { Success: true, Data: 'TK-TICH-HOP' } }
            if (g.url.endsWith('/invoiceweb/token')) return { json: { Success: true, Data: { access_token: 'TK-WEB' } } }
            if (g.url.includes('/invoiceweb/paging')) {
                dongPaging++
                if (dongPaging === 1) return { status: 401, json: { success: false, errorCode: 'TokenExpired' } }
                const start = g.body.Start
                const n = start === 0 ? 100 : 20
                return { json: { success: true, data: Array.from({ length: n }, (_, i) => ({ InvNo: String(start + i + 1), InvDate: g.body.FromDate })) } }
            }
            return { status: 404, text: 'không có' }
        })
        const thu = await thuKetNoi(sp)
        ok('8a. Thử kết nối: cả hai đường ok', thu.ok && thu.tichHop.ok && thu.web.ok, thu)
        const tk = goi.find(g => g.url.endsWith('/invoice/token'))!
        ok('8b. /invoice/token: header ClientID + ClientSecret, body {taxcode, username, password}',
            tk.headers.ClientID === 'CID-9' && tk.headers.ClientSecret === 'SEC-9' && tk.body.taxcode === '0312345678' && tk.body.username === 'kt@hungtin.vn' && tk.body.password === 'mk9', tk)
        const tw = goi.find(g => g.url.endsWith('/invoiceweb/token'))!
        ok('8c. /invoiceweb/token: body {TaxCode, UserName, Password} (chữ hoa đầu như tài liệu)', tw.body.TaxCode === '0312345678' && tw.body.UserName === 'kt@hungtin.vn' && tw.body.Password === 'mk9', tw)
        ok('8d. Token lưu trong DB đã mã hoá', sp.dong().tokenWeb && sp.dong().tokenWeb !== 'TK-WEB' && sp.dong().tokenTichHop !== 'TK-TICH-HOP')
        const kn = (await docKetNoi(sp))!
        const truocKhi = goi.length
        const { tho, ngayCat } = await dsHoaDonWeb(sp, kn, '2026-10-28', '2026-10-28', '6')
        const sau = goi.slice(truocKhi)
        const paging = sau.filter(g => g.url.includes('/invoiceweb/paging'))
        ok('8e. Token bị từ chối (401) ⇒ đăng nhập web lại MỘT lần rồi đọc tiếp', sau.some(g => g.url.endsWith('/invoiceweb/token')) && tho.length === 120, { soGoi: sau.map(g => g.url.split('/meinvoice')[1]), tho: tho.length })
        ok('8f. Đi trang: Start 0 rồi 100, Length 100, một ngày FromDate=ToDate, PublishStatus chuỗi "6"',
            paging.slice(1).map(g => g.body.Start).join(',') === '0,100' && paging.every(g => g.body.Length === 100 && g.body.FromDate === '2026-10-28' && g.body.ToDate === '2026-10-28' && g.body.PublishStatus === '6'), paging.map(g => g.body))
        ok('8g. Lời gọi web app có Authorization Bearer + ClientID + TaxCode; invoiceWithCode theo cấu hình',
            paging.slice(1).every(g => g.headers.Authorization === 'Bearer TK-WEB' && g.headers.ClientID === 'CID-9' && g.headers.TaxCode === '0312345678' && g.url.includes('invoiceWithCode=true')), paging[1]?.headers)
        ok('8h. Không chạm trần trang ⇒ ngayCat rỗng', ngayCat.length === 0, ngayCat)
        // trần trang: luôn trả đủ 100 ⇒ phải báo ngày bị cắt, không lặng lẽ
        misaGia((g) => g.url.includes('/invoiceweb/paging')
            ? { json: { success: true, data: Array.from({ length: 100 }, () => ({ InvNo: '1' })) } }
            : { json: { Success: true, Data: 'TK' } })
        const cat = await dsHoaDonWeb(sp, kn, '2026-10-27', '2026-10-28', '6', 2)
        ok('8i. Chạm trần trang ⇒ báo đúng ngày bị cắt (không cắt âm thầm)', cat.ngayCat.join(',') === '2026-10-27,2026-10-28' && cat.tho.length === 400, cat.ngayCat)
        // lỗi thật (không phải token) ⇒ ném nguyên văn, không thử lại vô tận
        let lan = 0
        misaGia((g) => { if (g.url.includes('/invoiceweb/paging')) { lan++; return { json: { success: false, errorCode: 'InvalidParameter', descriptionErrorCode: 'FromDate không hợp lệ' } } } return { json: { Success: true, Data: 'TK' } } })
        const loi = await nem(() => goiApi(sp, kn, 'web', '/invoiceweb/paging?invoiceWithCode=true', {}))
        ok('8j. Lỗi nghiệp vụ ⇒ báo nguyên văn MISA, gọi đúng 1 lần', loi.includes('FromDate không hợp lệ') && lan === 1, { loi, lan })
        misaGia(() => ({ status: 401, json: { statusCode: 401, message: 'Access denied due to invalid subscription key.' } }))
        const sp2 = spGia()
        await luuKetNoi(sp2, { clientId: 'SAI', clientSecret: 'SAI', mst: '0312345678', taiKhoan: 'a', matKhau: 'b' }, 'chu')
        const thu2 = await thuKetNoi(sp2)
        ok('8k. ClientID sai ⇒ thử kết nối báo lỗi cổng nguyên văn ở cả hai đường', !thu2.ok && String(thu2.tichHop.loi).includes('invalid subscription key') && String(thu2.web.loi).includes('invalid subscription key'), thu2)
        ok('8l. LoiMeInvoice là lỗi riêng (route hiện nguyên văn)', new LoiMeInvoice('x') instanceof Error && new LoiMeInvoice('x').name === 'LoiMeInvoice')
    }

    /* 9 — Khớp hoá đơn ↔ khách ↔ yêu cầu (chủ shop: chỉ khách gõ /hoadon, hoặc khách lấy định kỳ) */
    {
        const k = (id: string, code: string, luon = false) => ({ id, code, name: 'Khách ' + code, luonLayHoaDon: luon })
        const bang: BangKhach = {
            khach: new Map([['k1', k('k1', 'HN17')], ['k2', k('k2', 'HCM02', true)], ['k3', k('k3', 'A3')], ['k4', k('k4', 'A4')], ['k5', k('k5', 'KH005')]]),
            theoMaMisa: new Map([['misa-kh5', ['k5']], ['hn99', ['k5']]]),
            theoMa: new Map([['hn17', ['k1']], ['hcm02', ['k2']], ['a3', ['k3']], ['a4', ['k4']], ['kh005', ['k5']], ['hn99', ['k1']]]),
            theoMst: new Map([['0312345678', ['k1']], ['0101234567', ['k2']], ['0909090909', ['k3', 'k4']]]),
        }
        const p = (id: string, cid: string, ngay: string, total: number): PhieuLayHd => ({ id, receiptNumber: 'HD' + id, total, ngay, customerId: cid })
        const phieu = new Map<string, PhieuLayHd[]>([
            ['k1', [p('001', 'k1', '2026-10-27', 1_080_000), p('002', 'k1', '2026-10-20', 500_000), p('003', 'k1', '2026-08-01', 99)]],
            ['k5', [p('050', 'k5', '2026-10-28', 200_000)]],
        ])
        const nhom = new Map<string, NhomZalo[]>([['k1', [{ groupId: 'g1', tenNhom: 'Nhóm HN17' }]], ['k2', [{ groupId: 'g2', tenNhom: null }]]])
        const hd = (o: Partial<HoaDonMisa>): HoaDonMisa => ({ refId: null, kyHieu: '1C26TAA', so: '1', ngay: '2026-10-28', maKhach: null, mst: '', tenNguoiMua: null, tongTien: null, maTraCuu: null, trangThai: null, ...o })

        let d = quyetDinh(hd({ maKhach: 'hn17', tongTien: 1_080_000 }), bang, phieu, nhom, true)
        ok('9a. Mã khách (khác hoa thường) + phiếu Lấy HĐ hôm qua ⇒ SẼ GỬI nhóm của khách, phiếu trùng tiền xếp đầu',
            d.ketQua === 'se_gui' && d.khach?.id === 'k1' && d.nhom[0].groupId === 'g1' && d.phieu[0].receiptNumber === 'HD001' && d.phieu[0].trungTien, d)
        ok('9b. Phiếu ngoài cửa sổ 45 ngày không tính', !d.phieu.some(x => x.receiptNumber === 'HD003'), d.phieu)
        d = quyetDinh(hd({ mst: '0312345678' }), bang, phieu, nhom, true)
        ok('9c. Chỉ có MST (MST ứng đúng một khách) ⇒ ra khách, sẽ gửi', d.ketQua === 'se_gui' && d.khach?.id === 'k1', d)
        d = quyetDinh(hd({ maKhach: 'HCM02' }), bang, phieu, nhom, true)
        ok('9d. Khách "Luôn lấy hoá đơn" (lấy định kỳ), không cần phiếu ⇒ sẽ gửi', d.ketQua === 'se_gui' && d.lyDo.includes('Luôn lấy hoá đơn'), d)
        d = quyetDinh(hd({ mst: '0909090909' }), bang, phieu, nhom, true)
        ok('9e. MST trùng hai khách ⇒ KHÔNG tự chọn', d.ketQua === 'nhieu_khach' && d.khach === null, d)
        d = quyetDinh(hd({ tenNguoiMua: 'Bán cho người tiêu dùng' }), bang, phieu, nhom, true)
        ok('9f. "Bán cho người tiêu dùng" (không mã, không MST) ⇒ không đoán khách', d.ketQua === 'khong_ro_khach', d)
        d = quyetDinh(hd({ maKhach: 'ZZZ', mst: '0111111111' }), bang, phieu, nhom, true)
        ok('9g. Mã + MST không có trong Kengi ⇒ không thấy khách', d.ketQua === 'khong_thay_khach' && d.lyDo.includes('ZZZ'), d)
        d = quyetDinh(hd({ maKhach: 'MISA-KH5' }), bang, phieu, nhom, true)
        ok('9h. Mã MISA qua bảng nối ⇒ đúng khách; có yêu cầu mà chưa nối nhóm Zalo ⇒ không gửi, nói rõ', d.ketQua === 'chua_noi_nhom' && d.khach?.id === 'k5', d)
        d = quyetDinh(hd({ maKhach: 'HN99' }), bang, phieu, nhom, true)
        ok('9i. Bảng nối MISA THẮNG mã trùng (misaPush gửi mã nối trước mã Kengi)', d.khach?.id === 'k5', d)
        d = quyetDinh(hd({ maKhach: 'A3' }), bang, phieu, nhom, true)
        ok('9j. Khách không gõ /hoadon, không "Luôn lấy" ⇒ KHÔNG gửi', d.ketQua === 'khong_yeu_cau', d)
        d = quyetDinh(hd({ maKhach: 'HN17' }), bang, phieu, nhom, false)
        ok('9k. Chưa cấp mã ⇒ không gửi', d.ketQua === 'chua_cap_ma', d)
        d = quyetDinh(hd({ maKhach: 'HN17', ngay: '2026-12-30' }), bang, phieu, nhom, true)
        ok(`9l. Phiếu Lấy HĐ cũ hơn ${CUA_SO_NGAY} ngày ⇒ không tính là yêu cầu`, d.ketQua === 'khong_yeu_cau', d)
        d = quyetDinh(hd({ maKhach: 'HN17', ngay: null }), bang, phieu, nhom, true)
        ok('9m. Không đọc được ngày HĐ ⇒ không gửi, lý do nói đúng chuyện ngày', d.ketQua === 'khong_yeu_cau' && d.lyDo.includes('ngày'), d)
        const w = phieuTrongCuaSo(hd({ ngay: '2026-10-26' }), phieu.get('k1')!)
        ok('9n. Phiếu sau ngày HĐ 1 ngày vẫn tính (HĐ lập trước phiếu ghi sổ)', w.some(x => x.receiptNumber === 'HD001'), w)
        const t = timKhach(hd({ maKhach: 'hn17', mst: '0909090909' }), bang)
        ok('9o. Có mã ra đúng một khách ⇒ không xét MST trùng', 'khach' in t && t.khach.id === 'k1', t)
    }

    /* 10 — Đường API: khoá quản trị chỉ xem/thử/soi; soi chỉ coi "đã cấp mã" (6) là gửi được; đã gắn vào app */
    {
        const goc = path.join(__dirname, '..', 'src')
        const route = fs.readFileSync(path.join(goc, 'routes', 'meInvoice.ts'), 'utf8')
        const m = /QUA_KHOA_QUAN_TRI = new Set\(\[([^\]]*)\]\)/.exec(route)
        const ds = m ? m[1] : ''
        ok('10a. Khoá quản trị KHÔNG được PUT/DELETE kết nối', !!m && !/PUT|DELETE/.test(ds) && ds.includes("'POST /soi'"), ds)
        ok('10b. /soi: daCapMa = trangThai "6"', /xemTruocGui\(req\.storePrisma, hoaDons, trangThai === '6'\)/.test(route))
        ok('10c. PUT/DELETE/thử cần einvoice.config; xem/soi cần einvoice.view',
            /router\.put\('\/ket-noi', CAU_HINH/.test(route) && /router\.delete\('\/ket-noi', CAU_HINH/.test(route) && /router\.post\('\/ket-noi\/thu', CAU_HINH/.test(route)
            && /router\.get\('\/ket-noi', XEM/.test(route) && /router\.post\('\/soi', XEM/.test(route))
        const idx = fs.readFileSync(path.join(goc, 'index.ts'), 'utf8')
        ok('10d. Đã gắn /api/meinvoice', idx.includes("app.use('/api/meinvoice', meInvoiceRoutes)") && idx.includes("import meInvoiceRoutes from './routes/meInvoice'"))
        const lib = fs.readFileSync(path.join(goc, 'lib', 'meInvoice.ts'), 'utf8')
        ok('10e. Thư viện meInvoice CHỈ đọc: không gọi publishing / insert / delete / sendemail', !/\/invoice\/publishing|\/invoiceweb\/insert|\/invoiceweb\/delete|\/invoice\/sendemail/.test(lib.replace(/\/\*[\s\S]*?\*\//g, '')))
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
