/**
 * BỘ KIỂM: phiếu sửa chữa gắn hoá đơn ĐÃ HUỶ ⇒ chuyển sang hoá đơn ra lại (lib/chuyenPhieuSuaDonMoi.ts, 11/11/2026).
 *
 * Chủ shop: "các đơn đã huỷ ra lại đơn mới thì phiếu sửa chữa không gắn đơn mới mà gắn đơn cũ". KiotViet sửa hoá đơn bằng cách
 * huỷ rồi ra bản cùng số thêm đuôi (.01, .02); phiếu được gắn MỘT lần vào bản đầu nên kẹt ở bản đã huỷ.
 * Prisma giả trong bộ nhớ. Canh cả chiều "phải chuyển" lẫn "phải để yên".
 *
 * Chạy: npm run check:chuyen-phieu-sua
 */
import * as fs from 'fs'
import * as path from 'path'
import { chuyenPhieuSuaSangDonMoi, soGocHoaDon, duoiHoaDon } from '../src/lib/chuyenPhieuSuaDonMoi'

let dat = 0, loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { ok ? dat++ : loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }

type Tx = { id: string; receiptNumber: string; status: string; customerId: string | null }
type Phieu = { id: string; code: string; transactionId: string | null; soldReceiptNumber: string | null }
let txs: Tx[] = [], phieux: Phieu[] = []
let soGhi = 0

const khopChuoi = (v: any, f: any): boolean => {
    if (f === undefined) return true
    if (f === null || typeof f !== 'object') return v === f
    if ('in' in f) return f.in.includes(v)
    if ('startsWith' in f) return String(v ?? '').startsWith(f.startsWith)
    if ('not' in f) return v !== f.not
    return true
}
const khop = (o: any, w: any): boolean => !w || Object.entries(w).every(([k, f]) => k === 'OR' ? (f as any[]).some(x => khop(o, x)) : khopChuoi(o[k], f))
const chon = (o: any, sel: any) => { if (!sel) return { ...o }; const r: any = {}; for (const k of Object.keys(sel)) if (sel[k]) r[k] = o[k]; return r }
const sp: any = {
    transaction: {
        findMany: async ({ where, select }: any) => txs.filter(t => khop(t, where)).map(t => chon(t, select)),
        findUnique: async ({ where, select }: any) => { const t = txs.find(x => x.id === where.id); return t ? chon(t, select) : null },
    },
    repair: {
        findMany: async ({ where, select }: any) => phieux.filter(p => khop(p, where)).map(p => chon(p, select)),
        updateMany: async ({ where, data }: any) => { let count = 0; for (const p of phieux) if (khop(p, where)) { Object.assign(p, data); count++; soGhi++ } return { count } },
    },
}
const tx = (id: string, receiptNumber: string, status = 'completed', customerId: string | null = 'kh1'): Tx => ({ id, receiptNumber, status, customerId })
const ph = (id: string, transactionId: string | null, soldReceiptNumber: string | null = null): Phieu => ({ id, code: `RP-${id}`, transactionId, soldReceiptNumber })
const dat0 = (t: Tx[], p: Phieu[]) => { txs = t; phieux = p; soGhi = 0 }
const cua = (id: string) => phieux.find(p => p.id === id)!

async function main() {
    dung('1. số gốc: bỏ đúng đuôi .NN ở cuối; số không đuôi giữ nguyên; rỗng ⇒ rỗng',
        soGocHoaDon('HD031880.02') === 'HD031880' && soGocHoaDon('HD031880') === 'HD031880' && soGocHoaDon(' HD1.10 ') === 'HD1' && soGocHoaDon(null) === ''
        && soGocHoaDon('HD.A1') === 'HD.A1' && duoiHoaDon('HD031880.02') === 2 && duoiHoaDon('HD031880') === 0 && duoiHoaDon('HD1.10') === 10)

    // ── theo MỘT hoá đơn vừa đồng bộ về ──
    dat0([tx('a', 'HD031880', 'voided'), tx('b', 'HD031880.01', 'voided'), tx('c', 'HD031880.02')], [ph('p1', 'a', 'HD031880'), ph('p2', 'b', 'HD031880.01'), ph('p3', null)])
    const k2 = await chuyenPhieuSuaSangDonMoi(sp, { txId: 'c', apply: true })
    dung('2. bản .02 về ⇒ phiếu đang gắn bản gốc ĐÃ HUỶ và bản .01 ĐÃ HUỶ đều chuyển sang .02 (cả mã lẫn số hoá đơn); phiếu chưa gắn để yên',
        cua('p1').transactionId === 'c' && cua('p1').soldReceiptNumber === 'HD031880.02' && cua('p2').transactionId === 'c' && cua('p3').transactionId === null
        && k2.chuyen.length === 2 && k2.ganDonHuy === 2 && k2.chuyen[0].tuHoaDon === 'HD031880' && k2.chuyen[0].sangHoaDon === 'HD031880.02', JSON.stringify({ k2, phieux }))
    const k2b = await chuyenPhieuSuaSangDonMoi(sp, { txId: 'c', apply: true })
    dung('2b. chạy lại ⇒ không còn gì để chuyển, không ghi thêm', k2b.chuyen.length === 0 && soGhi === 2)

    dat0([tx('a', 'HD500', 'voided'), tx('c', 'HD500.01', 'voided')], [ph('p1', 'a', 'HD500')])
    const k3 = await chuyenPhieuSuaSangDonMoi(sp, { txId: 'c', apply: true })
    dung('3. hoá đơn vừa về CŨNG đã huỷ ⇒ KHÔNG chuyển (không dời phiếu từ đơn huỷ sang đơn huỷ)', cua('p1').transactionId === 'a' && k3.chuyen.length === 0 && soGhi === 0)

    dat0([tx('a', 'HD600'), tx('c', 'HD600.01')], [ph('p1', 'a', 'HD600')])
    await chuyenPhieuSuaSangDonMoi(sp, { txId: 'c', apply: true })
    dung('4. phiếu gắn hoá đơn CÒN HIỆU LỰC ⇒ để yên dù có bản cùng số gốc', cua('p1').transactionId === 'a' && soGhi === 0)

    dat0([tx('a', 'HD70', 'voided'), tx('x', 'HD700', 'voided'), tx('y', 'HD7', 'voided'), tx('c', 'HD70.01')], [ph('p1', 'a'), ph('p2', 'x'), ph('p3', 'y')])
    await chuyenPhieuSuaSangDonMoi(sp, { txId: 'c', apply: true })
    dung('5. chỉ CÙNG SỐ GỐC: HD70 chuyển sang HD70.01; HD700 và HD7 (khác số, chung tiền tố) để yên',
        cua('p1').transactionId === 'c' && cua('p2').transactionId === 'x' && cua('p3').transactionId === 'y')

    dat0([tx('a', 'HD800', 'voided', 'kh1'), tx('c', 'HD800.01', 'completed', 'kh2')], [ph('p1', 'a')])
    const k6 = await chuyenPhieuSuaSangDonMoi(sp, { txId: 'c', apply: true })
    dung('6. bản ra lại của KHÁCH KHÁC (cùng số gốc) ⇒ không chuyển, đếm vào "không có đơn mới"', cua('p1').transactionId === 'a' && k6.khongCoDonMoi === 1 && k6.chuyen.length === 0)
    dat0([tx('a', 'HD810', 'voided', null), tx('c', 'HD810.01', 'completed', 'kh2')], [ph('p1', 'a')])
    await chuyenPhieuSuaSangDonMoi(sp, { txId: 'c', apply: true })
    dung('6b. … một bên không có mã khách ⇒ vẫn chuyển (số gốc trùng là dấu vết đủ chắc)', cua('p1').transactionId === 'c')

    dat0([tx('a', 'HD900', 'voided'), tx('c', 'HD900.01')], [ph('p1', 'a', 'HD900')])
    const k7 = await chuyenPhieuSuaSangDonMoi(sp, { txId: 'c', apply: false })
    dung('7. CHẠY THỬ: báo sẽ chuyển gì nhưng KHÔNG ghi', k7.chuyen.length === 1 && k7.chuyen[0].maPhieu === 'RP-p1' && cua('p1').transactionId === 'a' && soGhi === 0)

    dung('8. mã hoá đơn không tồn tại ⇒ không làm gì, không ném', (await chuyenPhieuSuaSangDonMoi(sp, { txId: 'khong-co', apply: true })).ganDonHuy === 0)

    // ── quét toàn bộ (lệnh dọn) ──
    dat0([
        tx('a', 'HD1', 'voided'), tx('a1', 'HD1.01', 'voided'), tx('a2', 'HD1.02'), tx('a3', 'HD1.03'),   // hai bản còn hiệu lực ⇒ đuôi lớn nhất
        tx('b', 'HD2', 'voided'),                                                                          // huỷ hẳn, không ra lại
        tx('c', 'HD3'),                                                                                    // còn hiệu lực
        tx('d1', 'HD4.01', 'voided'), tx('d', 'HD4'),                                                      // bản .01 huỷ, bản GỐC còn hiệu lực (KV mở lại)
    ], [ph('p1', 'a'), ph('p2', 'a1'), ph('p3', 'b', 'HD2'), ph('p4', 'c', 'HD3'), ph('p5', 'd1'), ph('p6', null), ph('p7', 'mat-roi')])
    const k9 = await chuyenPhieuSuaSangDonMoi(sp, { apply: true })
    dung('9. quét hết: nhiều bản còn hiệu lực ⇒ đuôi LỚN NHẤT; đơn huỷ hẳn để yên; đơn còn hiệu lực để yên; bản gốc còn hiệu lực cũng là đích',
        cua('p1').transactionId === 'a3' && cua('p2').transactionId === 'a3' && cua('p3').transactionId === 'b' && cua('p3').soldReceiptNumber === 'HD2'
        && cua('p4').transactionId === 'c' && cua('p5').transactionId === 'd' && cua('p5').soldReceiptNumber === 'HD4' && cua('p6').transactionId === null && cua('p7').transactionId === 'mat-roi'
        && k9.ganDonHuy === 4 && k9.chuyen.length === 3 && k9.khongCoDonMoi === 1, JSON.stringify({ k9, phieux }))

    // phiếu vừa được lượt khác / người sửa đổi liên kết giữa chừng ⇒ không đè
    dat0([tx('a', 'HD50', 'voided'), tx('c', 'HD50.01')], [ph('p1', 'a')])
    const goc = sp.repair.updateMany
    sp.repair.updateMany = async (a: any) => { cua('p1').transactionId = 'nguoi-vua-sua'; return goc(a) }
    const k10 = await chuyenPhieuSuaSangDonMoi(sp, { apply: true })
    sp.repair.updateMany = goc
    dung('10. phiếu đổi liên kết giữa chừng ⇒ không đè (ghi có điều kiện "vẫn đang gắn bản đã huỷ đó"), không báo là đã chuyển',
        cua('p1').transactionId === 'nguoi-vua-sua' && k10.chuyen.length === 0)

    // ── theo hoá đơn VỪA BỊ HUỶ (bản ra lại về trước khi bản cũ bị huỷ) ──
    dat0([tx('a', 'HD40', 'voided'), tx('c', 'HD40.01'), tx('z', 'HD41', 'voided'), tx('z1', 'HD41.01')], [ph('p1', 'a', 'HD40'), ph('p2', 'z', 'HD41')])
    const k12 = await chuyenPhieuSuaSangDonMoi(sp, { donHuyId: 'a', apply: true })
    dung('12. hoá đơn vừa bị huỷ mà bản ra lại ĐÃ về ⇒ phiếu của ĐÚNG hoá đơn đó chuyển sang bản ra lại; phiếu của hoá đơn huỷ khác không đụng',
        cua('p1').transactionId === 'c' && cua('p1').soldReceiptNumber === 'HD40.01' && cua('p2').transactionId === 'z' && k12.chuyen.length === 1 && k12.ganDonHuy === 1)
    dat0([tx('a', 'HD42'), tx('c', 'HD42.01')], [ph('p1', 'a')])
    const k12b = await chuyenPhieuSuaSangDonMoi(sp, { donHuyId: 'a', apply: true })
    dung('12b. … hoá đơn đó CHƯA huỷ ⇒ không làm gì; chưa có bản ra lại ⇒ để yên, đếm "không có đơn mới"', cua('p1').transactionId === 'a' && k12b.ganDonHuy === 0
        && (dat0([tx('a', 'HD43', 'voided')], [ph('p1', 'a')]), (await chuyenPhieuSuaSangDonMoi(sp, { donHuyId: 'a', apply: true })).khongCoDonMoi === 1) && cua('p1').transactionId === 'a')
    const nguonHuy = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'kiotvietSync.ts'), 'utf8')
    const viTriHuy = nguonHuy.indexOf(`data: { status: 'voided' } })`)
    const viTriGoi = nguonHuy.indexOf('await chuyenPhieuSuaSangDonMoi(sp, { donHuyId: daCo.id, apply: true }).catch(')
    dung('12c. đồng bộ gọi chuyển phiếu ngay sau khi đánh dấu hoá đơn huỷ', viTriHuy > 0 && viTriGoi > viTriHuy && viTriGoi - viTriHuy < 400, `${viTriHuy} ${viTriGoi}`)

    const nguon = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'kiotvietSync.ts'), 'utf8')
    const than = nguon.slice(nguon.indexOf('async function ganPhieuSuaChuaKhiSync'), nguon.indexOf('async function saveMap'))
    dung('11. đồng bộ hoá đơn gọi chuyển phiếu TRƯỚC rào "không có mã khách" / "đơn cũ quá 7 ngày", lỗi không phá đợt đồng bộ',
        than.indexOf('chuyenPhieuSuaSangDonMoi(sp, { txId, apply: true }).catch(') > 0
        && than.indexOf('chuyenPhieuSuaSangDonMoi') < than.indexOf('!localCustomerId') && than.indexOf('chuyenPhieuSuaSangDonMoi') < than.indexOf('7 * 864e5'))

    console.log(`\n${loi === 0 ? '✅' : '❌'} ${dat} đạt, ${loi} hỏng\n`)
    if (loi > 0) process.exitCode = 1
}
main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
