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
    luuKetNoi, docKetNoi, thuKetNoi, goiApi, dsHoaDonPhatHanh, doTho, doTrangThai, moTaHinh, LoiMeInvoice, CONG_MAC_DINH, type KetNoiMeInvoice, type HoaDonMisa,
} from '../src/lib/meInvoice'
import { quyetDinh, timKhach, phieuTrongCuaSo, CUA_SO_NGAY, type BangKhach, type PhieuLayHd, type NhomZalo, type DongXemTruoc } from '../src/lib/hoaDonMisaZalo'
import {
    ketLuanTrangThai, docPdf, bienHoaDon, linkHoaDon, chonUngVien, nhanTrangThaiGui, trongGioGui, xepMot, TOKEN_RE, MAU_MAC_DINH, LAN_TU_DONG_TOI_DA,
    type DongDaGui,
} from '../src/lib/guiHoaDonMisa'
import { dienMau } from '../src/lib/zaloGui'

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
        // 29/10: "0 hoá đơn" phải là rỗng THẬT, không phải hình lạ
        ok('5f. data null / mảng rỗng / {Items:null} / {Total:0} ⇒ rỗng thật (docDuoc)',
            [null, [], { Items: null }, { Total: 0 }, {}].every(v => tachDanhSach(v).docDuoc && tachDanhSach(v).ds.length === 0))
        const la = tachDanhSach({ Result: [{ InvNo: '1' }], Count: 1 })
        ok('5g. Object có danh sách ở khoá lạ ⇒ KHÔNG đọc được (không phải 0 hoá đơn)', !la.docDuoc && la.ds.length === 0, la)
        ok('5h. Chuỗi không phải JSON / {Data:"rác"} ⇒ không đọc được', !tachDanhSach('lỗi gì đó').docDuoc && !tachDanhSach({ Data: 'rác' }).docDuoc)
        ok('5i. moTaHinh: chỉ khung, không lộ giá trị', moTaHinh({ Result: [{ AccountObjectName: 'Công ty A' }], Count: 1 }) === 'object {Result, Count}' && moTaHinh([1, 2]) === 'mảng 2 phần tử' && moTaHinh(null) === 'rỗng')
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
        // NGUỒN SOI = danh sách tích hợp /invoice/paging (đo HUTI 29/10/2026: {PageData, TotalCount, Summary}); web app chỉ còn để dò
        const TICH = '/invoice/paging?'
        const THUONG = '/invoiceweb/paging?'
        const MTT = '/invoiceweb/paging/calculating?'
        const trangTich = (ds: any[], tong: number | null) => ({ json: { Success: true, Data: { PageData: ds, TotalCount: tong, Summary: {} } } })
        const sp = spGia()
        await luuKetNoi(sp, { clientId: 'CID-9', clientSecret: 'SEC-9', mst: '0312345678', taiKhoan: 'kt@hungtin.vn', matKhau: 'mk9' }, 'chu')
        let dongPaging = 0
        const goi = misaGia((g) => {
            if (g.url.endsWith('/invoice/token')) return { json: { Success: true, Data: 'TK-TICH-HOP' } }
            if (g.url.endsWith('/invoiceweb/token')) return { json: { Success: true, Data: { access_token: 'TK-WEB' } } }
            if (g.url.includes(TICH)) {
                dongPaging++
                if (dongPaging === 1) return { status: 401, json: { Success: false, ErrorCode: 'TokenExpired' } }
                const skip = g.body.Skip
                const n = skip === 0 ? 100 : 20
                return trangTich(Array.from({ length: n }, (_, i) => ({ RefID: `r${skip + i}`, InvNo: String(skip + i + 1), InvDate: g.body.FromDate + 'T00:00:00+07:00', TransactionID: `MTC${skip + i}` })), 120)
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
        const { tho, ngayCat, thieu } = await dsHoaDonPhatHanh(sp, kn, '2026-10-28', '2026-10-28')
        const sau = goi.slice(truocKhi)
        const paging = sau.filter(g => g.url.includes(TICH))
        ok('8e. Token bị từ chối (401) ⇒ đăng nhập TÍCH HỢP lại MỘT lần rồi đọc tiếp', sau.some(g => g.url.endsWith('/invoice/token')) && tho.length === 120, { soGoi: sau.map(g => g.url.split('/meinvoice')[1]), tho: tho.length })
        ok('8f. Đi trang: Skip 0 rồi 100, Take 100, một ngày FromDate=ToDate, ListInvTemplate rỗng (mọi ký hiệu)',
            paging.slice(1).map(g => g.body.Skip).join(',') === '0,100' && paging.every(g => g.body.Take === 100 && g.body.FromDate === '2026-10-28' && g.body.ToDate === '2026-10-28' && Array.isArray(g.body.ListInvTemplate) && g.body.ListInvTemplate.length === 0), paging.map(g => g.body))
        ok('8g. Danh sách tích hợp: Bearer token TÍCH HỢP + ClientID, KHÔNG TaxCode; invoiceWithCode theo cấu hình',
            paging.slice(1).every(g => g.headers.Authorization === 'Bearer TK-TICH-HOP' && g.headers.ClientID === 'CID-9' && !('TaxCode' in g.headers) && g.url.includes('invoiceWithCode=true')), paging[1]?.headers)
        ok('8h. Đọc đủ TotalCount, không chạm trần ⇒ ngayCat + thieu rỗng', ngayCat.length === 0 && thieu.length === 0, { ngayCat, thieu })
        // trần trang: luôn trả đủ 100 ⇒ phải báo ngày bị cắt, không lặng lẽ
        misaGia((g) => g.url.includes(TICH) ? trangTich(Array.from({ length: 100 }, () => ({ InvNo: '1' })), 1000) : { json: { Success: true, Data: 'TK' } })
        const cat = await dsHoaDonPhatHanh(sp, kn, '2026-10-27', '2026-10-28', 2)
        ok('8i. Chạm trần trang ⇒ báo đúng ngày bị cắt (không cắt âm thầm)', cat.ngayCat.join(',') === '2026-10-27,2026-10-28' && cat.tho.length === 400 && cat.thieu.length === 0, cat.ngayCat)
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

        // 29/10/2026 — HĐ máy tính tiền nằm CHUNG danh sách tích hợp (cờ IsInvoiceCalculatingMachine); trang chồng ⇒ đếm một lần
        const goiM = misaGia((g) => g.url.includes(TICH)
            ? trangTich([{ RefID: 'r-1', InvNo: '1', IsInvoiceCalculatingMachine: false }, { RefID: 'r-2', InvSeries: '1C26MAA', InvNo: '2', IsInvoiceCalculatingMachine: true }, { RefID: 'r-1', InvNo: '1' }], 3)
            : { json: { Success: true, Data: 'TK' } })
        const hai = await dsHoaDonPhatHanh(sp, { ...kn, coMa: false }, '2026-10-28', '2026-10-28')
        ok('8m. Máy tính tiền theo cờ IsInvoiceCalculatingMachine; trùng RefID đếm một lần; invoiceWithCode theo cấu hình (không mã)',
            goiM.some(g => g.url.includes('/invoice/paging?invoiceWithCode=false')) && hai.tho.length === 2 && hai.demNguon.thuong === 1 && hai.demNguon.mtt === 1
            && hai.dong.find(d => d.raw.RefID === 'r-2')?.nguon === 'mtt' && hai.thieu.length === 0, { tho: hai.tho, dem: hai.demNguon, thieu: hai.thieu })
        misaGia((g) => g.url.includes(TICH) ? trangTich([{ RefID: 'a' }, { RefID: 'b' }, { RefID: 'c' }], 5) : { json: { Success: true, Data: 'TK' } })
        const it = await dsHoaDonPhatHanh(sp, kn, '2026-10-28', '2026-10-28')
        ok('8n. MISA báo TotalCount 5 mà chỉ trả 3 ⇒ ghi "thiếu" (không coi là đủ)', it.thieu.length === 1 && it.thieu[0].misa === 5 && it.thieu[0].doc === 3, it.thieu)
        misaGia((g) => g.url.includes(TICH) ? { json: { Success: false, ErrorCode: 'InvalidTaxCode', Errors: ['MST không khớp'] } } : { json: { Success: true, Data: 'TK' } })
        const loiDs = await nem(() => dsHoaDonPhatHanh(sp, kn, '2026-10-28', '2026-10-28'))
        ok('8o. MISA báo lỗi ⇒ BÁO LỖI nguyên văn (không trả "0 hoá đơn")', loiDs.includes('MST không khớp') && loiDs.includes('InvalidTaxCode'), loiDs)
        misaGia((g) => g.url.includes(TICH) ? { json: { Success: true, Data: { Result: [{ InvNo: '1' }], Count: 1 } } } : { json: { Success: true, Data: 'TK' } })
        const la = await dsHoaDonPhatHanh(sp, kn, '2026-10-28', '2026-10-28')
        ok('8p. Hình lạ ⇒ ghi "không đọc được" kèm khung, không lặng lẽ thành 0', la.tho.length === 0 && la.khongDocDuoc.length === 1
            && la.khongDocDuoc[0].hinh === 'object {Result, Count}' && la.thieu.length === 0, la.khongDocDuoc)

        const goiD = misaGia((g) => {
            if (g.url.includes(MTT)) return { json: { success: true, data: [{ RefID: 'r-9', InvNo: '9', AccountObjectName: 'x'.repeat(300), Detail: [1, 2] }] } }
            if (g.url.includes('/invoiceweb/paging?invoiceWithCode=false')) return { json: { success: false, errorCode: 'InvalidParameter', descriptionErrorCode: 'Sai loại hoá đơn' } }
            if (g.url.includes(THUONG)) return { json: { success: true, data: { Result: [], Count: 0 } } }
            return { json: { Success: true, Data: 'TK' } }
        })
        const bt = (nguon: 'thuong' | 'mtt', coMa: boolean) => ({ nguon, coMa, trangThai: '6', tu: '2026-10-01', den: '2026-10-29', start: 0, length: 3 })
        const dt = await doTho(sp, kn, [bt('thuong', true), bt('thuong', false), bt('mtt', true)])
        ok('8q. Dò thô: MISA báo lỗi ⇒ KHÔNG ném, trả lỗi nguyên văn + chữ thô', dt[1].ok === false && String(dt[1].loi).includes('Sai loại hoá đơn') && String(dt[1].tho).includes('InvalidParameter'), dt[1])
        ok('8r. Dò thô: hình lạ ⇒ docDuoc=false + khung; có dữ liệu ⇒ tên trường + mẫu rút gọn',
            dt[0].ok && dt[0].docDuoc === false && dt[0].khung?.Result === '[mảng 0]' && dt[2].soDong === 1 && dt[2].truong.join(',') === 'AccountObjectName,Detail,InvNo,RefID'
            && dt[2].mau[0].AccountObjectName.length === 161 && dt[2].mau[0].Detail === '[mảng 2]', dt)
        ok('8s. Dò thô gửi đúng cả khoảng một lần, Length nhỏ, đúng đường từng biến thể',
            goiD.filter(g => g.url.includes('/invoiceweb/paging')).every(g => g.body.FromDate === '2026-10-01' && g.body.ToDate === '2026-10-29' && g.body.Length === 3)
            && goiD.filter(g => g.url.includes(MTT)).length === 1 && goiD.filter(g => g.url.includes(THUONG)).length === 2)
        // danh sách TÍCH HỢP theo ký hiệu (/invoice/paging): token tích hợp, Skip/Take/ListInvTemplate, data {Total, Items}
        const goiT = misaGia((g) => g.url.includes('/invoice/paging?')
            ? { json: { Success: true, Data: { Total: 3393, Items: [{ TransactionID: 'MTC1', InvNo: '00003393', InvDate: '2026-10-07', BuyerName: 'Công ty A', BuyerTaxCode: '0312345678', TotalAmount: 13251981, Status: 1 }] } } }
            : { json: { Success: true, Data: 'TK-TICH-HOP-2' } })
        const th = await doTho(sp, kn, [{ ...bt('thuong', true), nguon: 'tichHop', kyHieu: ['1C26TSG'] }])
        const gT = goiT.find(g => g.url.includes('/invoice/paging?'))!
        ok('8t. Dò thô danh sách tích hợp: /invoice/paging, Bearer token TÍCH HỢP, không TaxCode, body Skip/Take/ListInvTemplate; đọc {Total, Items}',
            !!gT && gT.url.includes('invoiceWithCode=true') && gT.headers.Authorization?.startsWith('Bearer ') && gT.headers.Authorization !== 'Bearer TK-WEB' && !('TaxCode' in gT.headers)
            && gT.body.Skip === 0 && gT.body.Take === 3 && gT.body.ListInvTemplate.join() === '1C26TSG' && gT.body.FromDate === '2026-10-01'
            && th[0].ok && th[0].soDong === 1 && th[0].tong === 3393 && th[0].truong.includes('TransactionID') && th[0].dsSo.join() === '-00003393', { gT, th })
        // trạng thái theo mã tra cứu: tài liệu tự mâu thuẫn ⇒ chỉ ĐO, đúng tham số đường + thân là mảng mã
        const goiS = misaGia((g) => g.url.includes('/invoice/status?')
            ? { json: { Success: true, Data: [{ TransactionID: 'MTC1', SendTaxStatus: 2, IsDelete: false, ReferenceType: 0 }] } }
            : { json: { Success: true, Data: 'TK' } })
        const tt = await doTrangThai(sp, kn, ['MTC1'])
        const gS = goiS.find(g => g.url.includes('/invoice/status?'))!
        ok('8u. Dò trạng thái: /invoice/status?inputType=1 + invoiceWithCode + invoiceCalcu, thân = mảng mã tra cứu, token tích hợp; trả tên trường',
            !!gS && gS.url.includes('inputType=1') && gS.url.includes('invoiceWithCode=true') && gS.url.includes('invoiceCalcu=false') && Array.isArray(gS.body) && gS.body[0] === 'MTC1'
            && !('TaxCode' in gS.headers) && tt.ok && (tt as any).truong.includes('SendTaxStatus'), { gS, tt })
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
        ok('10b. /soi đọc danh sách HĐ ĐÃ PHÁT HÀNH (tích hợp, mọi kênh lập), không phải web app', /dsHoaDonPhatHanh\(req\.storePrisma/.test(route) && !/dsHoaDonWeb/.test(route))
        ok('10c. PUT/DELETE/thử cần einvoice.config; xem/soi cần einvoice.view',
            /router\.put\('\/ket-noi', CAU_HINH/.test(route) && /router\.delete\('\/ket-noi', CAU_HINH/.test(route) && /router\.post\('\/ket-noi\/thu', CAU_HINH/.test(route)
            && /router\.get\('\/ket-noi', XEM/.test(route) && /router\.post\('\/soi', XEM/.test(route))
        const idx = fs.readFileSync(path.join(goc, 'index.ts'), 'utf8')
        ok('10d. Đã gắn /api/meinvoice', idx.includes("app.use('/api/meinvoice', meInvoiceRoutes)") && idx.includes("import meInvoiceRoutes from './routes/meInvoice'"))
        const lib = fs.readFileSync(path.join(goc, 'lib', 'meInvoice.ts'), 'utf8')
        ok('10e. Thư viện meInvoice CHỈ đọc: không gọi publishing / insert / delete / sendemail', !/\/invoice\/publishing|\/invoiceweb\/insert|\/invoiceweb\/delete|\/invoice\/sendemail/.test(lib.replace(/\/\*[\s\S]*?\*\//g, '')))
        ok('10f. /do-tho: quyền xem, khoá quản trị được dùng để đo', /router\.post\('\/do-tho', XEM/.test(route) && ds.includes("'POST /do-tho'"), ds)
        ok('10g. /soi báo cảnh báo khi hình lạ / đọc thiếu so với TotalCount (không để 0 che đọc hỏng)', /canhBao/.test(route) && /ph\.khongDocDuoc/.test(route) && /ph\.thieu/.test(route))
    }

    /* 11 — GỬI (29/10/2026, chủ shop: "làm phần gửi luôn đi"): 4 cửa — trạng thái MISA, PDF thật, giành một lần, hàng đợi Zalo */
    {
        // hình /invoice/status đo HUTI 29/10/2026
        const st = (o: any = {}) => ({ TransactionID: 'M1', SendTaxStatus: 2, IsDelete: false, EInvoiceStatus: 1, ReferenceType: 0, ...o })
        ok('11a. Đã cấp mã, không xoá, HĐ gốc ⇒ gửi được', ketLuanTrangThai(st(), true).guiDuoc)
        let k = ketLuanTrangThai(st({ SendTaxStatus: 0 }), true)
        ok('11b. Chưa cấp mã ⇒ không gửi, KHÔNG bỏ hẳn (lượt sau thử lại)', !k.guiDuoc && !k.vinhVien && String(k.lyDo).includes('cấp mã'), k)
        k = ketLuanTrangThai(st({ IsDelete: true, DeletedReason: 'Lập sai' }), true)
        ok('11c. Bị xoá ⇒ bỏ hẳn, nói lý do MISA', !k.guiDuoc && k.vinhVien && String(k.lyDo).includes('Lập sai'), k)
        // Bảng mã MISA (đọc lại 29/10/2026 — chủ shop gặp HĐ "= 3" bị chặn oan): 1 gốc · 2 huỷ · 3 THAY THẾ · 5 ĐIỀU CHỈNH; bị thay thế = RefInvoiceStatus 3
        k = ketLuanTrangThai(st({ EInvoiceStatus: 3 }), true)
        ok('11d. EInvoiceStatus 3 = hoá đơn THAY THẾ (hợp lệ) ⇒ GỬI, kèm ghi chú', k.guiDuoc && k.ghiChu === 'hoá đơn thay thế', k)
        ok('11d1. EInvoiceStatus 5 = hoá đơn điều chỉnh ⇒ gửi; bị điều chỉnh (RefInvoiceStatus 5) vẫn còn hiệu lực ⇒ gửi',
            ketLuanTrangThai(st({ EInvoiceStatus: 5 }), true).guiDuoc && ketLuanTrangThai(st({ RefInvoiceStatus: 5 }), true).guiDuoc)
        k = ketLuanTrangThai(st({ EInvoiceStatus: 2 }), true)
        ok('11d2. EInvoiceStatus 2 = bị huỷ ⇒ bỏ hẳn', !k.guiDuoc && k.vinhVien && String(k.lyDo).includes('huỷ'), k)
        k = ketLuanTrangThai(st({ RefInvoiceStatus: 3 }), true)
        ok('11d3. BỊ thay thế (RefInvoiceStatus 3) ⇒ bỏ hẳn (khách nhận hoá đơn thay thế)', !k.guiDuoc && k.vinhVien && String(k.lyDo).includes('thay thế'), k)
        ok('11d4. Thuế không chấp nhận (SendTaxStatus 3 / 4) ⇒ bỏ hẳn, kể cả hoá đơn không mã',
            ketLuanTrangThai(st({ SendTaxStatus: 4 }), true).vinhVien && ketLuanTrangThai(st({ SendTaxStatus: 3 }), false).vinhVien)
        k = ketLuanTrangThai(undefined, true)
        ok('11e. MISA không trả trạng thái ⇒ không gửi, thử lại sau (không đoán là được)', !k.guiDuoc && !k.vinhVien, k)
        ok('11f. CQT từ chối cấp mã ⇒ bỏ hẳn', ketLuanTrangThai(st({ SendTaxStatus: 3 }), true).vinhVien)

        const pdf64 = Buffer.from('%PDF-1.4 hoa don thu').toString('base64')
        ok('11g. docPdf: {TransactionID, Data base64} ⇒ đúng tệp PDF', docPdf([{ TransactionID: 'M0', Data: 'x' }, { TransactionID: 'M1', Data: pdf64 }], 'M1').subarray(0, 4).toString() === '%PDF')
        ok('11h. docPdf: data là chuỗi JSON, khoá chữ thường "data" ⇒ vẫn đọc', docPdf(JSON.stringify([{ TransactionID: 'M1', data: pdf64 }]), 'M1').length > 4)
        let loi = await nem(async () => docPdf([{ TransactionID: 'M1', Data: Buffer.from('<html>').toString('base64') }], 'M1'))
        ok('11i. Không phải PDF ⇒ báo lỗi (không gửi link chết)', loi.includes('không phải PDF'), loi)
        loi = await nem(async () => docPdf([{ TransactionID: 'M1', ErrorCode: 'InvoiceNotFound' }], 'M1'))
        ok('11j. MISA không trả tệp ⇒ báo kèm mã lỗi', loi.includes('InvoiceNotFound'), loi)
        loi = await nem(async () => docPdf([{ TransactionID: 'KHAC', Data: pdf64 }], 'M1'))
        ok('11j2. Tệp trả về mang mã tra cứu KHÁC ⇒ lỗi, không lấy bừa (gửi nhầm hoá đơn người khác)', loi.includes('không trả tệp'), loi)

        const hd: HoaDonMisa = { refId: 'r1', kyHieu: '1C26TSG', so: '00003655', ngay: '2026-10-28', maKhach: 'HT02', mst: '0312345678', tenNguoiMua: 'Công ty A', tongTien: 15_593_000, maTraCuu: 'ABCD1234EFGH', trangThai: null }
        const link = linkHoaDon('HUTI', 'x'.repeat(24))
        const tin = dienMau(MAU_MAC_DINH, { tenKhach: 'Điện máy HT', bien: bienHoaDon(hd, { InvoiceName: 'Hóa đơn giá trị gia tăng' }, link) })
        ok('11k. Tin mặc định: loại HĐ, số, ký hiệu, ngày dd/mm/yyyy, tổng tiền có dấu chấm, mã tra cứu, link — không sót {biến}',
            ['Điện máy HT', 'Hóa đơn giá trị gia tăng số 00003655', '1C26TSG', '28/10/2026', '15.593.000đ', 'ABCD1234EFGH', link].every(s => tin.includes(s)) && !/\{\w+\}/.test(tin), tin)
        ok('11l. Link bền = /api/meinvoice/hd/<mã cửa hàng>/<token 24 ký tự> (gốc không lặp /api)', link === `https://api.kengi.vn/api/meinvoice/hd/HUTI/${'x'.repeat(24)}` && TOKEN_RE.test('x'.repeat(24)), link)

        const d = (ma: string | null, ketQua: any = 'se_gui', ngay = '2026-10-28'): DongXemTruoc => ({
            hoaDon: { ...hd, maTraCuu: ma, ngay }, ketQua, lyDo: '', khach: { id: 'k1', code: 'HT02', name: 'HT', luonLayHoaDon: true }, nhom: [{ groupId: 'g1', tenNhom: 'Nhóm HT02' }], phieu: [],
        })
        const so = (ma: string, trangThai: any, lanThu = 1) => [ma, { maTraCuu: ma, trangThai, lanThu } as DongDaGui] as [string, DongDaGui]
        const dongs = [d('A'), d('B', 'khong_yeu_cau'), d('C', 'se_gui', '2026-10-20'), d(null), d('E'), d('F'), d('G'), d('H')]
        const uv = chonUngVien(dongs, dongs.map(() => ({})), dongs.map(() => 'thuong'), new Map([so('E', 'da_xep'), so('F', 'bo_qua'), so('G', 'loi', 2), so('H', 'loi', LAN_TU_DONG_TOI_DA)]), '2026-10-25')
        ok('11m. Tự động chỉ lấy: "sẽ gửi" + có mã tra cứu + ngày ≥ ngày bật + chưa xếp/bỏ + lỗi chưa quá lượt',
            uv.map(u => u.dong.hoaDon.maTraCuu).join() === 'A,G', uv.map(u => u.dong.hoaDon.maTraCuu))

        const r = (trangThai: any, o: any = {}) => ({ trangThai, loi: null, lanThu: 0, capNhatLuc: 1, dotId: 'd1', ...o }) as DongDaGui
        ok('11n. Nhãn: mọi nhóm đã gửi ⇒ "Đã gửi Zalo"', nhanTrangThaiGui(r('da_xep'), [{ trangThai: 'da_gui', loi: null }, { trangThai: 'da_gui', loi: null }]).ma === 'da_gui')
        ok('11o. Nhãn: còn nhóm chờ ⇒ đang chờ; chỉ còn lỗi ⇒ "Gửi Zalo lỗi" kèm lỗi; đợt huỷ hết ⇒ "Đã huỷ gửi"',
            nhanTrangThaiGui(r('da_xep'), [{ trangThai: 'da_gui', loi: null }, { trangThai: 'cho', loi: null }]).ma === 'dang'
            && nhanTrangThaiGui(r('da_xep'), [{ trangThai: 'loi', loi: 'Nhóm đã giải tán' }]).chiTiet === 'Nhóm đã giải tán'
            && nhanTrangThaiGui(r('da_xep'), [{ trangThai: 'huy', loi: null }]).nhan === 'Đã huỷ gửi')
        ok('11p. Giờ gửi tự động 7:00–20:59 giờ VN', !trongGioGui(new Date('2026-10-28T23:59:00Z')) && trongGioGui(new Date('2026-10-29T00:00:00Z'))
            && trongGioGui(new Date('2026-10-29T13:59:00Z')) && !trongGioGui(new Date('2026-10-29T14:00:00Z')))

        // Sổ MeInvoiceDaGui + hàng đợi Zalo giả — đủ để kiểm "giành một lần", lỗi thử lại, bỏ thì không bao giờ gửi
        const so2 = new Map<string, any>()
        const dot: any[] = []
        const hang: any[] = []
        let hongHangDoi = false
        const spG: any = {
            __schema: 'kiem_gui',
            async $executeRawUnsafe(sql: string, ...p: any[]) {
                const s = sql.replace(/\s+/g, ' ').trim()
                if (s.startsWith('CREATE TABLE')) return 0
                if (s.startsWith('UPDATE "MeInvoiceKetNoi"')) return 1   // lưu token đăng nhập — không phải việc của bộ kiểm này
                if (s.startsWith('INSERT INTO "MeInvoiceDaGui"')) {   // ghiKhongGui
                    const [ma, token, , , , , , customerId, maKhach, mtt, trangThai, loiG, , , luc] = p
                    const c = so2.get(ma)
                    if (!c) { so2.set(ma, { maTraCuu: ma, token, customerId, maKhach, mtt, trangThai, loi: loiG, lanThu: 1, capNhatLuc: luc }); return 1 }
                    if (c.trangThai !== 'loi') return 0
                    Object.assign(c, { trangThai, loi: loiG, lanThu: c.lanThu + 1, capNhatLuc: luc }); return 1
                }
                if (/^UPDATE "MeInvoiceDaGui" SET "dotId"=\$2/.test(s)) { so2.get(p[0]).dotId = p[1]; return 1 }
                if (/^UPDATE "MeInvoiceDaGui" SET "trangThai"='da_xep'/.test(s)) { Object.assign(so2.get(p[0]), { trangThai: 'da_xep', soNhom: p[1], loi: null }); return 1 }
                if (/^UPDATE "MeInvoiceDaGui" SET "trangThai"='loi'/.test(s)) { const c = so2.get(p[0]); if (c?.trangThai === 'dang_xep') Object.assign(c, { trangThai: 'loi', loi: p[1], dotId: null }); return 1 }
                throw new Error('SQL lạ: ' + s.slice(0, 80))
            },
            async $queryRawUnsafe(sql: string, ...p: any[]) {
                const s = sql.replace(/\s+/g, ' ').trim()
                if (s.startsWith('INSERT INTO "MeInvoiceDaGui"') && s.includes('RETURNING "token"') && !s.includes('WHERE')) {   // giành ÉP (gửi tay)
                    const [ma, token, , , , , , customerId, maKhach, mtt, nguoi, luc] = p
                    const c = so2.get(ma)
                    if (!c) { so2.set(ma, { maTraCuu: ma, token, customerId, maKhach, mtt, trangThai: 'dang_xep', loi: null, lanThu: 0, nguon: 'tay', nguoi, capNhatLuc: luc }); return [{ token }] }
                    Object.assign(c, { trangThai: 'dang_xep', loi: null, nguon: 'tay', nguoi, capNhatLuc: luc }); return [{ token: c.token }]
                }
                if (s.startsWith('INSERT INTO "MeInvoiceDaGui"') && s.includes('RETURNING "token"')) {   // giành
                    const [ma, token, , , , , , customerId, maKhach, mtt, nguon, nguoi, luc] = p
                    const c = so2.get(ma)
                    if (!c) { so2.set(ma, { maTraCuu: ma, token, customerId, maKhach, mtt, trangThai: 'dang_xep', loi: null, lanThu: 0, nguon, nguoi, capNhatLuc: luc }); return [{ token }] }
                    if (c.trangThai !== 'loi') return []
                    Object.assign(c, { trangThai: 'dang_xep', loi: null, nguon, nguoi, capNhatLuc: luc }); return [{ token: c.token }]
                }
                throw new Error('SQL lạ: ' + s.slice(0, 80))
            },
            zaloDotGui: {
                create: async ({ data }: any) => { const x = { id: `dot${dot.length + 1}`, ...data }; dot.push(x); return x },
                updateMany: async ({ where, data }: any) => { dot.filter(x => x.id === where.id).forEach(x => Object.assign(x, data)); return { count: 1 } },
            },
            zaloDotGuiNhom: {
                createMany: async ({ data }: any) => { if (hongHangDoi) throw new Error('mất kết nối DB'); hang.push(...data); return { count: data.length } },
                count: async ({ where }: any) => hang.filter(x => x.dotId === where.dotId).length,
            },
        }
        const spMeinvoice = spGia()
        await luuKetNoi(spMeinvoice, { clientId: 'CID-9', clientSecret: 'SEC-9', mst: '0312345678', taiKhoan: 'kt@hungtin.vn', matKhau: 'mk9' }, 'chu')
        const knG = (await docKetNoi(spMeinvoice))!
        let pdfTra: any = [{ TransactionID: 'ABCD1234EFGH', Data: pdf64 }]
        const goiPdf = misaGia((g) => g.url.includes('/invoice/Download?') ? { json: { Success: true, Data: pdfTra } } : { json: { Success: true, Data: 'TK-TICH-HOP' } })
        const uvA = { dong: { ...d('ABCD1234EFGH'), nhom: [{ groupId: 'g1', tenNhom: 'Nhóm 1' }, { groupId: 'g2', tenNhom: null }] }, raw: { InvoiceName: 'Hóa đơn giá trị gia tăng' }, mtt: false }
        const ok1 = await xepMot(spG, 'HUTI', knG, uvA, ketLuanTrangThai(st(), true), MAU_MAC_DINH, 'tay', 'chu@x')
        const dongSo = so2.get('ABCD1234EFGH')
        const bienA = JSON.parse(hang[0]?.bien || '{}')
        ok('11q. Đủ 4 cửa ⇒ MỘT đợt Zalo, mỗi nhóm một dòng, biến có link chứa đúng token trong sổ; sổ = da_xep + dotId',
            ok1.ketQua === 'da_xep' && dot.length === 1 && hang.length === 2 && dongSo.trangThai === 'da_xep' && dongSo.dotId === 'dot1'
            && bienA.linkHoaDon === linkHoaDon('HUTI', dongSo.token) && dot[0].noiDung === MAU_MAC_DINH && goiPdf.some(g => g.url.includes('downloadDataType=Pdf')), { ok1, dongSo, bienA })
        const lai = await xepMot(spG, 'HUTI', knG, uvA, ketLuanTrangThai(st(), true), MAU_MAC_DINH, 'tu_dong', null)
        ok('11r. Xếp lại hoá đơn đã gửi ⇒ "đã có", KHÔNG thêm đợt (không bao giờ gửi hai lần)', lai.ketQua === 'da_co' && dot.length === 1 && hang.length === 2, lai)

        const uvB = { ...uvA, dong: { ...uvA.dong, hoaDon: { ...hd, maTraCuu: 'BBBB1234EFGH' } } }
        const b1 = await xepMot(spG, 'HUTI', knG, uvB, ketLuanTrangThai(st({ SendTaxStatus: 0 }), true), MAU_MAC_DINH, 'tu_dong', null)
        pdfTra = [{ TransactionID: 'BBBB1234EFGH', Data: Buffer.from('<html>').toString('base64') }]
        const b2 = await xepMot(spG, 'HUTI', knG, uvB, ketLuanTrangThai(st(), true), MAU_MAC_DINH, 'tu_dong', null)
        const tokenB = so2.get('BBBB1234EFGH').token
        pdfTra = [{ TransactionID: 'BBBB1234EFGH', Data: pdf64 }]
        const b3 = await xepMot(spG, 'HUTI', knG, uvB, ketLuanTrangThai(st(), true), MAU_MAC_DINH, 'tu_dong', null)
        ok('11s. Chưa cấp mã ⇒ lỗi (chưa đợt); PDF hỏng ⇒ lỗi lần 2; lượt sau đủ cửa ⇒ xếp gửi, GIỮ token cũ',
            b1.ketQua === 'loi' && b2.ketQua === 'loi' && String(b2.lyDo).includes('PDF') && b3.ketQua === 'da_xep' && so2.get('BBBB1234EFGH').token === tokenB
            && so2.get('BBBB1234EFGH').lanThu === 2 && dot.length === 2, { b1, b2, b3 })

        const uvC = { ...uvA, dong: { ...uvA.dong, hoaDon: { ...hd, maTraCuu: 'CCCC1234EFGH' } } }
        const c1 = await xepMot(spG, 'HUTI', knG, uvC, ketLuanTrangThai(st({ IsDelete: true }), true), MAU_MAC_DINH, 'tu_dong', null)
        const c2 = await xepMot(spG, 'HUTI', knG, uvC, ketLuanTrangThai(st(), true), MAU_MAC_DINH, 'tay', 'chu@x')
        ok('11t. HĐ đã bỏ (bị xoá) ⇒ không bao giờ vào hàng đợi, kể cả lượt sau', c1.ketQua === 'bo_qua' && c2.ketQua !== 'da_xep' && so2.get('CCCC1234EFGH').trangThai === 'bo_qua' && dot.length === 2, { c1, c2 })

        const uvD = { ...uvA, dong: { ...uvA.dong, hoaDon: { ...hd, maTraCuu: 'DDDD1234EFGH' } } }
        pdfTra = [{ TransactionID: 'DDDD1234EFGH', Data: pdf64 }]
        hongHangDoi = true
        const dLoi = await nem(() => xepMot(spG, 'HUTI', knG, uvD, ketLuanTrangThai(st(), true), MAU_MAC_DINH, 'tu_dong', null))
        hongHangDoi = false
        ok('11u. Tạo dòng hàng đợi hỏng ⇒ đợt rỗng bị huỷ, sổ về "loi" (chưa tin nào đi ⇒ được thử lại)',
            dLoi.includes('mất kết nối DB') && so2.get('DDDD1234EFGH').trangThai === 'loi' && dot[2].trangThai === 'huy', { dLoi, so: so2.get('DDDD1234EFGH'), dot: dot[2] })

        // Chủ shop 29/10/2026: "khi gửi tay thì bắt buộc gửi" — batBuoc bỏ qua cửa trạng thái / PDF, gửi cả HĐ đã bỏ / đã gửi, giữ link
        const tokenC = so2.get('CCCC1234EFGH').token
        const soDotTruoc = dot.length
        pdfTra = [{ TransactionID: 'KHAC', Data: pdf64 }]   // PDF hỏng cũng không chặn gửi tay
        const ep1 = await xepMot(spG, 'HUTI', knG, uvC, ketLuanTrangThai(st({ IsDelete: true }), true), MAU_MAC_DINH, 'tay', 'chu@x', true)
        ok('11z1. Gửi tay bắt buộc: HĐ đã "bỏ" (bị xoá) + PDF hỏng ⇒ VẪN xếp gửi, giữ token cũ (link cũ chạy), sổ ghi gửi tay',
            ep1.ketQua === 'da_xep' && dot.length === soDotTruoc + 1 && so2.get('CCCC1234EFGH').trangThai === 'da_xep'
            && so2.get('CCCC1234EFGH').token === tokenC && so2.get('CCCC1234EFGH').nguon === 'tay', { ep1, so: so2.get('CCCC1234EFGH') })
        pdfTra = [{ TransactionID: 'ABCD1234EFGH', Data: pdf64 }]
        const ep2 = await xepMot(spG, 'HUTI', knG, uvA, ketLuanTrangThai(st(), true), MAU_MAC_DINH, 'tay', 'chu@x', true)
        ok('11z2. Gửi tay bắt buộc HĐ ĐÃ gửi ⇒ gửi lại (đợt mới), tự động thì vẫn "đã có"',
            ep2.ketQua === 'da_xep' && dot.length === soDotTruoc + 2 && so2.get('ABCD1234EFGH').dotId === dot[dot.length - 1].id
            && (await xepMot(spG, 'HUTI', knG, uvA, ketLuanTrangThai(st(), true), MAU_MAC_DINH, 'tu_dong', null)).ketQua === 'da_co', { ep2 })

        const goc = path.join(__dirname, '..', 'src')
        const route = fs.readFileSync(path.join(goc, 'routes', 'meInvoice.ts'), 'utf8')
        const viTriCongKhai = route.indexOf("router.get('/hd/:ma/:token'")
        const viTriDangNhap = route.indexOf('router.use(')
        ok('11v. Link công khai /hd/:ma/:token khai TRƯỚC lớp đăng nhập', viTriCongKhai > 0 && viTriDangNhap > viTriCongKhai)
        const qk = (/QUA_KHOA_QUAN_TRI = new Set\(\[([^\]]*)\]\)/.exec(route) || [])[1] || ''
        ok('11w. Khoá quản trị KHÔNG gửi được tin / sửa cài đặt gửi; gửi tay + sửa cài đặt cần einvoice.config',
            !qk.includes("'POST /gui'") && !qk.includes("'PUT /gui/cai-dat'") && /router\.post\('\/gui', CAU_HINH/.test(route) && /router\.put\('\/gui\/cai-dat', CAU_HINH/.test(route), qk)
        const cron = fs.readFileSync(path.join(goc, 'routes', 'cronTick.ts'), 'utf8')
        ok('11x. Cron gọi nhipGuiHoaDonMisa mỗi 10 phút', /% 10 === 6\)[\s\S]{0,200}import\('\.\.\/lib\/guiHoaDonMisa'\)[\s\S]{0,120}nhipGuiHoaDonMisa\(\)/.test(cron))
        const libGui = fs.readFileSync(path.join(goc, 'lib', 'guiHoaDonMisa.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
        ok('11y. Phần gửi chỉ ĐỌC MISA (status / Download) — không phát hành, không gửi email, không xoá', !/\/invoice\/publishing|\/invoiceweb\/insert|\/invoiceweb\/delete|\/invoice\/sendemail/.test(libGui) && libGui.includes('/invoice/status') && libGui.includes('/invoice/Download'))
        const thanGuiTay = (/export async function guiTay[\s\S]*?\n\}/.exec(libGui) || [''])[0]
        ok('11z3. guiTay = bắt buộc gửi: gọi xepMot(…, true), KHÔNG chặn vì "khách không yêu cầu" / đã gửi / đã bỏ',
            /'tay', nguoi, true\)/.test(thanGuiTay) && !/ketQua !== 'se_gui'/.test(thanGuiTay) && !/trangThai === 'bo_qua'/.test(thanGuiTay), thanGuiTay.slice(0, 200))
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
