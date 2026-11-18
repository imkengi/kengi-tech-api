/**
 * Kiểm DÒNG TIỀN THEO NGÀY THU của phiếu thu KiotViet — npx tsx scripts/check-dong-tien-kv.ts
 *
 * Vì sao có bộ này (18/11/2026): chủ shop "sao phiếu thu 60 tr mà vào trong dòng tiền có 20 triệu hơn".
 * Đo prod chỉ đọc: một phiếu TT… thu trong ngày bị KiotViet phân bổ vào 4 hoá đơn cũ ⇒ 4 Payment không
 * ngày ⇒ trang Dòng Tiền hiện mỗi phần ở NGÀY HOÁ ĐƠN, ngày thu chỉ thấy phần trừ vào hoá đơn cùng ngày.
 * Phiếu không phân bổ (DebtEntry) thì không hiện chút nào. Dữ liệu dưới đây là GIẢ (mã, tiền, khách).
 * Bộ này giữ các luật (lib/phieuThuKiotViet.ts + 2 route):
 *   A. phiếu thu RIÊNG = TT… không phải TTHD… (thu lúc bán ở lại dòng bán);
 *   B. dò bảng trước khi đọc, chỉ nhớ khi CÓ; không bảng ⇒ rỗng, không đọc PhieuThuKV;
 *   C. ngày thu theo mã: chỉ mã riêng, lỗi đọc NÉM (để trang không tách nửa vời);
 *   D. mỗi mã MỘT dòng đúng ngày thu, gom đủ mẩu ở mọi hoá đơn; bỏ HĐ huỷ, bỏ credit; phiếu không phân
 *      bổ cũng có; không đếm hai lần; khoá chi nhánh; tìm một mã; cắt + cờ catBot;
 *   S. hai route gắn đúng: GET /transactions chỉ đọc ngày khi kemNgayThu=1 và báo ngayThuKV; route
 *      /cash-receipts/phieu-thu-kv có auth + lọc chi nhánh.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL_KIEM || 'postgresql://kiem@127.0.0.1:1/kiem'   // không ca nào được chạm DB thật

import { readFileSync } from 'fs'
import { join } from 'path'
import {
    laPhieuThuRiengKV, coBangPhieuThuKV, docNgayThuPhieuRiengKV, docPhieuThuRiengKV,
} from '../src/lib/phieuThuKiotViet'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

/* ─── CSDL giả: chỉ hiểu đúng các câu SQL thư viện dùng ─────────────────────────────────────────── */
interface Kho {
    coBang?: boolean
    ngay?: { ma: string; ngay: string; soTien?: number | null }[]
    phieu?: { id: string; receiptNumber: string; createdAt: string; status?: string; customerId?: string | null; customerName?: string | null; branchId?: string | null }[]
    tien?: { transactionId: string; type: string; amount: number; reference: string | null }[]
    no?: { customerId: string; customerName: string; amount: number; description: string; createdAt: string; type?: string }[]
    hongDoc?: boolean
}
function dbGia(k: Kho) {
    const s = { sql: [] as string[], ...k }
    const utc = (v: string) => new Date(String(v)).getTime()   // tham số là ISO; cột lưu UTC
    const db: any = {
        _s: s,
        $executeRawUnsafe: async () => 0,
        $queryRawUnsafe: async (sql: string, ...a: any[]) => {
            s.sql.push(sql)
            if (/to_regclass\('"PhieuThuKV"'\)/.test(sql)) return [{ co: !!s.coBang }]
            if (s.hongDoc) throw new Error('mất kết nối giả')
            if (/SELECT "ma", "ngay" FROM "PhieuThuKV" WHERE "ma" = ANY/.test(sql)) {
                return (s.ngay ?? []).filter(r => a[0].includes(r.ma)).map(r => ({ ma: r.ma, ngay: new Date(r.ngay) }))
            }
            if (/SELECT "ma", "ngay", "soTien" FROM "PhieuThuKV"/.test(sql)) {
                const thamSo = (re: RegExp) => { const m = re.exec(sql); return m ? a[Number(m[1]) - 1] : undefined }
                const ma = thamSo(/"ma" = \$(\d+)/)
                const tu = thamSo(/"ngay" >= \(\$(\d+)/)
                const den = thamSo(/"ngay" < \(\$(\d+)/)
                const lim = thamSo(/LIMIT \$(\d+)/)
                // Fake chỉ lọc khi CÂU SQL có điều kiện — bỏ điều kiện khỏi code là ca kiểm đỏ
                const boTTHD = /"ma" !~ '\^TTHD'/.test(sql), chiTT = /"ma" ~ '\^TT\[A-Z\]\*\[0-9\]'/.test(sql)
                return (s.ngay ?? [])
                    .filter(r => (!boTTHD || !/^TTHD/.test(r.ma)) && (!chiTT || /^TT[A-Z]*[0-9]/.test(r.ma)))
                    .filter(r => (ma === undefined || r.ma === ma) && (tu === undefined || utc(r.ngay) >= utc(tu)) && (den === undefined || utc(r.ngay) < utc(den)))
                    .sort((x, y) => utc(y.ngay) - utc(x.ngay) || (x.ma < y.ma ? 1 : -1))
                    .slice(0, lim)
                    .map(r => ({ ma: r.ma, ngay: new Date(r.ngay), soTien: r.soTien ?? null }))
            }
            if (/FROM "Payment" p JOIN "Transaction" t/.test(sql)) {
                const cn = /t\."branchId" = \$2/.test(sql) ? a[1] : undefined
                const boCredit = /p\.type <> 'credit'/.test(sql), boHuy = /t\.status <> 'voided'/.test(sql)
                const out: any[] = []
                for (const p of s.tien ?? []) {
                    if (!a[0].includes(p.reference) || (boCredit && p.type === 'credit')) continue
                    const t = (s.phieu ?? []).find(x => x.id === p.transactionId)
                    if (!t || (boHuy && (t.status ?? 'completed') === 'voided')) continue
                    if (cn !== undefined && t.branchId !== cn) continue
                    out.push({ ma: p.reference, amount: p.amount, type: p.type, maHD: t.receiptNumber, ngayHD: new Date(t.createdAt), customerId: t.customerId ?? null, customerName: t.customerName ?? null })
                }
                return out
            }
            if (/FROM "DebtEntry"/.test(sql)) {
                const thamSo = (re: RegExp) => { const m = re.exec(sql); return m ? a[Number(m[1]) - 1] : undefined }
                const moTa = thamSo(/description = \$(\d+)/)
                const tu = thamSo(/"createdAt" >= \(\$(\d+)/)
                const den = thamSo(/"createdAt" < \(\$(\d+)/)
                const lim = thamSo(/LIMIT \$(\d+)/)
                const chiTraNo = /type = 'payment'/.test(sql) && /description LIKE 'Trả nợ — phiếu thu %'/.test(sql) && /description LIKE '%\(KiotViet\)'/.test(sql)
                return (s.no ?? [])
                    .filter(d => !chiTraNo || ((d.type ?? 'payment') === 'payment' && d.description.startsWith('Trả nợ — phiếu thu ') && d.description.endsWith('(KiotViet)')))
                    .filter(d => (moTa === undefined || d.description === moTa) && (tu === undefined || utc(d.createdAt) >= utc(tu)) && (den === undefined || utc(d.createdAt) < utc(den)))
                    .sort((x, y) => utc(y.createdAt) - utc(x.createdAt))
                    .slice(0, lim)
                    .map(d => ({ ...d, createdAt: new Date(d.createdAt) }))
            }
            throw new Error(`SQL lạ trong bộ kiểm: ${sql.slice(0, 80)}`)
        },
    }
    return db
}

/* Ca thật của chủ shop (số đo prod 18/11/2026, mã đổi tên): phiếu 60tr thu 18/11 17:05 VN = 10:05Z */
const NGAY_PHIEU = '2026-11-18T10:05:00.000Z'
const caChuShop = (): Kho => ({
    coBang: true,
    ngay: [
        { ma: 'TT900559', ngay: NGAY_PHIEU, soTien: 60_000_000 },
        { ma: 'TT900523', ngay: '2026-11-14T10:32:00.000Z', soTien: 25_000_000 },
        { ma: 'TTHD900155', ngay: '2026-11-18T01:00:00.000Z', soTien: 500_000 },
    ],
    phieu: [
        { id: 'h1', receiptNumber: 'HD900747', createdAt: '2026-10-24T00:08:00.000Z', customerId: 'kh1', customerName: 'Khách A' },
        { id: 'h2', receiptNumber: 'HD900771.02', createdAt: '2026-10-26T00:14:00.000Z', customerId: 'kh1', customerName: 'Khách A' },
        { id: 'h3', receiptNumber: 'HD900094.02', createdAt: '2026-11-14T00:21:00.000Z', customerId: 'kh1', customerName: 'Khách A' },
        { id: 'h4', receiptNumber: 'HD900153', createdAt: '2026-11-18T00:10:00.000Z', customerId: 'kh1', customerName: 'Khách A' },
        // hoá đơn khách trả NGAY lúc bán (TTHD) — phải ở lại dòng bán, không thành dòng phiếu thu riêng
        { id: 'h5', receiptNumber: 'HD900155', createdAt: '2026-11-18T01:00:00.000Z', customerId: 'kh9', customerName: 'Khách lẻ' },
    ],
    tien: [
        { transactionId: 'h1', type: 'cash', amount: 22_000_000, reference: 'TT900523' },
        { transactionId: 'h1', type: 'cash', amount: 13_000_000, reference: 'TT900559' },
        { transactionId: 'h2', type: 'cash', amount: 7_500_000, reference: 'TT900559' },
        { transactionId: 'h3', type: 'cash', amount: 18_500_000, reference: 'TT900559' },
        { transactionId: 'h4', type: 'cash', amount: 21_000_000, reference: 'TT900559' },
        { transactionId: 'h4', type: 'credit', amount: 39_900_000, reference: null },
        { transactionId: 'h4', type: 'credit', amount: 5, reference: 'TT900559' },   // credit mang mã ⇒ vẫn KHÔNG là tiền thu
        { transactionId: 'h5', type: 'cash', amount: 500_000, reference: 'TTHD900155' },
    ],
})
const ngayVN = (d: string) => ({ tu: new Date(`${d}T00:00:00+07:00`), den: new Date(new Date(`${d}T00:00:00+07:00`).getTime() + 86400_000) })

async function main() {
    console.log('\nA. Phiếu thu RIÊNG vs thu lúc bán')
    ok('TT900559 là phiếu riêng', laPhieuThuRiengKV('TT900559'))
    ok('TTHD900153 (thu lúc bán) KHÔNG phải', !laPhieuThuRiengKV('TTHD900153'))
    ok('TTDH000123 (đặt cọc đơn) là phiếu riêng — tiền vào đúng ngày cọc', laPhieuThuRiengKV('TTDH000123'))
    ok('mã rỗng / mã hoá đơn / chữ thường lạ KHÔNG phải', !laPhieuThuRiengKV('') && !laPhieuThuRiengKV(null) && !laPhieuThuRiengKV('HD900153') && !laPhieuThuRiengKV('Thanh toán nợ'))
    ok('khoảng trắng hai đầu vẫn nhận', laPhieuThuRiengKV('  TT900559 '))

    console.log('\nB. Dò bảng PhieuThuKV')
    {
        const db = dbGia({ coBang: false })
        ok('chưa có bảng ⇒ false', (await coBangPhieuThuKV(db)) === false)
        ok('vẫn chưa có bảng, hỏi lần hai vẫn false (không nhớ nhầm thành "có")', (await coBangPhieuThuKV(db)) === false)
        db._s.coBang = true
        ok('"chưa có" KHÔNG được nhớ — tạo bảng xong hỏi lại thấy ngay', (await coBangPhieuThuKV(db)) === true)
        const n = db._s.sql.length
        await coBangPhieuThuKV(db)
        ok('"có" được nhớ — lần sau không dò lại', db._s.sql.length === n)
    }

    console.log('\nC. Ngày thu theo mã (GET /transactions?kemNgayThu=1)')
    {
        const db = dbGia(caChuShop())
        const m = await docNgayThuPhieuRiengKV(db, ['TT900559', 'TT900559', 'TTHD900155', null, '', 'TT900523', 'TT999999'])
        ok('mã riêng đã biết ngày có mặt', m.get('TT900559')?.toISOString() === NGAY_PHIEU && m.has('TT900523'))
        ok('TTHD (thu lúc bán) KHÔNG có ngày ⇒ ở lại dòng bán', !m.has('TTHD900155'))
        ok('mã chưa biết ngày vắng ⇒ ở lại dòng bán như cũ', !m.has('TT999999'))
        const sqlHoi = db._s.sql.filter((x: string) => /FROM "PhieuThuKV" WHERE "ma" = ANY/.test(x))
        ok('một câu hỏi cho cả mẻ (gộp trùng)', sqlHoi.length === 1)
    }
    {
        const db = dbGia({ coBang: false, ngay: [{ ma: 'TT1', ngay: NGAY_PHIEU }] })
        const m = await docNgayThuPhieuRiengKV(db, ['TT100001'])
        ok('không có bảng ⇒ rỗng, KHÔNG đọc PhieuThuKV (khỏi log "Raw query failed")', m.size === 0 && !db._s.sql.some((x: string) => /FROM "PhieuThuKV"/.test(x)))
    }
    {
        const db = dbGia({ coBang: true })
        const m = await docNgayThuPhieuRiengKV(db, ['TTHD1', null, 'HD1'])
        ok('không có mã riêng nào ⇒ không hỏi CSDL', m.size === 0 && db._s.sql.length === 0)
    }
    {
        const db = dbGia({ ...caChuShop(), hongDoc: true })
        let nem = false
        try { await docNgayThuPhieuRiengKV(db, ['TT900559']) } catch { nem = true }
        ok('đọc hỏng ⇒ NÉM (route báo ngayThuKV:false, trang không tách nửa vời)', nem)
    }

    console.log('\nD. Danh sách phiếu thu theo ngày thu (GET /cash-receipts/phieu-thu-kv)')
    {
        const db = dbGia(caChuShop())
        const r = await docPhieuThuRiengKV(db, ngayVN('2026-11-18'))
        const p = r.phieu.find(x => x.ma === 'TT900559')
        ok('ngày 18/11: phiếu 60tr hiện ĐỦ 60.000.000 (trước sửa: 21.000.000)', p?.soTien === 60_000_000, p?.soTien)
        ok('đúng ngày thu 17:05 VN', p?.ngay.toISOString() === NGAY_PHIEU)
        ok('gom đủ 4 hoá đơn, xếp cũ → mới', p?.hoaDon.map(h => h.ma).join(',') === 'HD900747,HD900771.02,HD900094.02,HD900153', p?.hoaDon)
        ok('tên khách + phương thức theo mẩu lớn nhất', p?.khachTen === 'Khách A' && p?.khachId === 'kh1' && p?.phuongThuc === 'cash')
        ok('khớp sổ quỹ KiotViet (soTienKV)', p?.soTienKV === 60_000_000)
        ok('chỉ một phiếu ngày 18/11 (TTHD không vào, TT 14/11 không vào)', r.phieu.length === 1, r.phieu.map(x => x.ma))
        ok('không bị cắt', r.catBot === false)
        ok('credit trên hoá đơn KHÔNG tính là tiền thu', p?.hoaDon.every(h => h.soTien > 0) && p?.soTien === 60_000_000)
    }
    {
        const db = dbGia(caChuShop())
        const r = await docPhieuThuRiengKV(db, ngayVN('2026-10-24'))
        ok('ngày 24/10 (ngày hoá đơn cũ) KHÔNG còn phiếu thu nào — tiền 18/11 không lùi về đây', r.phieu.length === 0, r.phieu.map(x => x.ma))
        const r14 = await docPhieuThuRiengKV(db, ngayVN('2026-11-14'))
        ok('ngày 14/11: phiếu 25tr nằm đúng ngày của nó', r14.phieu.length === 1 && r14.phieu[0]!.ma === 'TT900523' && r14.phieu[0]!.soTien === 22_000_000)
    }
    {
        const k = caChuShop()
        k.phieu!.find(t => t.id === 'h2')!.status = 'voided'
        const r = await docPhieuThuRiengKV(dbGia(k), ngayVN('2026-11-18'))
        ok('mẩu trên hoá đơn ĐÃ HUỶ bị bỏ (khớp Lịch sử công nợ)', r.phieu[0]?.soTien === 60_000_000 - 7_500_000 && r.phieu[0]?.hoaDon.length === 3)
    }
    {
        const k = caChuShop()
        k.ngay!.push({ ma: 'TT900600', ngay: '2026-11-18T03:00:00.000Z', soTien: 5_000_000 })
        k.no = [
            { customerId: 'kh2', customerName: 'Khách B', amount: 5_000_000, description: 'Trả nợ — phiếu thu TT900600 (KiotViet)', createdAt: '2026-11-18T03:00:00.000Z' },
            // lỡ có dòng trả nợ cho mã ĐÃ phân bổ ⇒ không cộng lần hai
            { customerId: 'kh1', customerName: 'Khách A', amount: 60_000_000, description: 'Trả nợ — phiếu thu TT900559 (KiotViet)', createdAt: NGAY_PHIEU },
            // dòng trả nợ tay (không phải KiotViet) ⇒ không thuộc danh sách này
            { customerId: 'kh3', customerName: 'Khách C', amount: 1_000_000, description: 'Thu nợ tại quầy', createdAt: '2026-11-18T04:00:00.000Z' },
        ]
        const r = await docPhieuThuRiengKV(dbGia(k), ngayVN('2026-11-18'))
        const b = r.phieu.find(x => x.ma === 'TT900600')
        ok('phiếu KHÔNG phân bổ (DebtEntry) cũng hiện — trước sửa không hiện chút nào', b?.soTien === 5_000_000 && b?.khongGanHoaDon === true && b?.khachTen === 'Khách B')
        const c = r.phieu.find(x => x.ma === 'TT900559')
        ok('mã đã phân bổ có thêm dòng trả nợ ⇒ KHÔNG đếm hai lần, giữ nguyên các mẩu', c?.soTien === 60_000_000 && c?.hoaDon.length === 4 && c?.khongGanHoaDon === false, c)
        ok('dòng trả nợ không phải KiotViet không lẫn vào', r.phieu.length === 2, r.phieu.map(x => x.ma))
        ok('xếp mới nhất trước', r.phieu[0]!.ma === 'TT900559' && r.phieu[1]!.ma === 'TT900600')
    }
    {
        const k = caChuShop()
        k.phieu!.find(t => t.id === 'h3')!.branchId = 'cn2'
        for (const t of k.phieu!) if (t.id !== 'h3') t.branchId = 'cn1'
        k.no = [{ customerId: 'kh2', customerName: 'Khách B', amount: 5_000_000, description: 'Trả nợ — phiếu thu TT900600 (KiotViet)', createdAt: '2026-11-18T03:00:00.000Z' }]
        const r = await docPhieuThuRiengKV(dbGia(k), { ...ngayVN('2026-11-18'), branchId: 'cn1' })
        ok('khoá chi nhánh: chỉ mẩu trên hoá đơn của chi nhánh đó', r.phieu.length === 1 && r.phieu[0]!.soTien === 60_000_000 - 18_500_000)
        ok('khoá chi nhánh: phiếu không phân bổ (không mang chi nhánh) bị bỏ', !r.phieu.some(x => x.ma === 'TT900600'))
    }
    {
        const db = dbGia(caChuShop())
        const r = await docPhieuThuRiengKV(db, { tu: null, den: null, ma: 'TT900523' })
        ok('tìm đúng một mã — bỏ qua khoảng ngày', r.phieu.length === 1 && r.phieu[0]!.ma === 'TT900523')
        const n = db._s.sql.length
        const r2 = await docPhieuThuRiengKV(db, { tu: null, den: null, ma: 'TTHD900155' })
        ok('tìm mã TTHD / mã lạ ⇒ rỗng, không hỏi thêm CSDL', r2.phieu.length === 0 && db._s.sql.length === n)
    }
    {
        const k = caChuShop()
        k.ngay!.push({ ma: 'TT900700', ngay: '2026-11-17T02:00:00.000Z', soTien: 1_000_000 })
        k.phieu!.push({ id: 'h9', receiptNumber: 'HD900999', createdAt: '2026-11-01T02:00:00.000Z', customerId: 'kh1', customerName: 'Khách A' })
        k.tien!.push({ transactionId: 'h9', type: 'bank_transfer', amount: 1_000_000, reference: 'TT900700' })
        k.no = [{ customerId: 'kh2', customerName: 'Khách B', amount: 2_000_000, description: 'Trả nợ — phiếu thu TT900400 (KiotViet)', createdAt: '2026-11-10T03:00:00.000Z' }]
        const r = await docPhieuThuRiengKV(dbGia(k), { tu: null, den: null, gioiHan: 2 })
        ok('cắt theo giới hạn: giữ 2 phiếu mới nhất + cờ catBot', r.catBot === true && r.phieu.map(x => x.ma).join(',') === 'TT900559,TT900700', r.phieu.map(x => x.ma))
        ok('bị cắt ⇒ phiếu không phân bổ CŨ hơn mốc cắt không chen vào (khỏi hổng giữa)', !r.phieu.some(x => x.ma === 'TT900400'))
        ok('phương thức chuyển khoản giữ nguyên', r.phieu.find(x => x.ma === 'TT900700')?.phuongThuc === 'bank_transfer')
    }
    {
        const k = caChuShop()
        k.ngay!.push({ ma: 'TT900801', ngay: '2026-11-17T17:00:00.000Z' })   // 00:00 VN 18/11 — đầu ngày
        k.ngay!.push({ ma: 'TT900802', ngay: '2026-11-18T17:00:00.000Z' })   // 00:00 VN 19/11 — sang ngày sau
        k.phieu!.push({ id: 'h8', receiptNumber: 'HD900888', createdAt: '2026-11-01T00:00:00.000Z', customerId: 'kh1', customerName: 'Khách A' })
        k.tien!.push({ transactionId: 'h8', type: 'cash', amount: 100, reference: 'TT900801' }, { transactionId: 'h8', type: 'cash', amount: 200, reference: 'TT900802' })
        const r = await docPhieuThuRiengKV(dbGia(k), ngayVN('2026-11-18'))
        ok('biên ngày giờ VN: 00:00 18/11 VN vào, 00:00 19/11 VN không', r.phieu.some(x => x.ma === 'TT900801') && !r.phieu.some(x => x.ma === 'TT900802'))
    }
    {
        const k = caChuShop()
        k.ngay!.push({ ma: 'TT900900', ngay: NGAY_PHIEU, soTien: 3_000_000 })   // phiếu đã biết ngày nhưng KHÔNG có mẩu nào / không dòng nợ
        const r = await docPhieuThuRiengKV(dbGia(k), ngayVN('2026-11-18'))
        ok('phiếu chưa có tiền nào trong Kengi (chưa đồng bộ / đã huỷ) KHÔNG hiện số 0', !r.phieu.some(x => x.ma === 'TT900900'))
    }
    {
        const r = await docPhieuThuRiengKV(dbGia({ coBang: false }), ngayVN('2026-11-18'))
        ok('cửa hàng không dùng KiotViet (không bảng) ⇒ rỗng, không lỗi', r.phieu.length === 0 && r.catBot === false)
        let nem = false
        try { await docPhieuThuRiengKV(dbGia({ ...caChuShop(), hongDoc: true }), ngayVN('2026-11-18')) } catch { nem = true }
        ok('đọc hỏng ⇒ NÉM (route trả 500, trang không tách)', nem)
    }

    console.log('\nS. Gắn vào route')
    const goc = join(__dirname, '..')
    const tx = readFileSync(join(goc, 'src/routes/transactions.ts'), 'utf8')
    const getList = tx.slice(tx.indexOf(`router.get('/', authMiddleware`), tx.indexOf(`// GET /api/transactions/stats`))
    ok('GET /transactions chỉ đọc ngày thu khi kemNgayThu=1', /if \(q\.kemNgayThu === '1'\) \{\s*try \{\s*ngayThuKV = await docNgayThuPhieuRiengKV\(/.test(getList))
    ok('GET /transactions báo ngayThuKV true/false (hỏng ⇒ false, không ném 500)', /ngayThuKVDu = true/.test(getList) && /catch \(e\) \{[\s\S]{0,200}ngayThuKVDu = false/.test(getList) && /ngayThuKV: ngayThuKVDu/.test(getList))
    ok('ngayThu chỉ gắn cho mẩu không phải credit', /p\.type !== 'credit' \? ngayThuKV\?\.get\(/.test(getList))
    const cr = readFileSync(join(goc, 'src/routes/cashReceipts.ts'), 'utf8')
    const route = cr.slice(cr.indexOf(`router.get('/phieu-thu-kv'`), cr.indexOf(`router.get('/phieu-thu-kv'`) + 2500)
    ok('route /cash-receipts/phieu-thu-kv có, có authMiddleware', /router\.get\('\/phieu-thu-kv', authMiddleware,/.test(cr))
    ok('route lọc chi nhánh như danh sách phiếu thu', /getBranchFilter\(req\)/.test(route) && /branchId: loc\.branchId \?\? null/.test(route))
    ok('route cắt ngày theo GIỜ VN, trọn ngày cuối', /T00:00:00\+07:00/.test(route) && /86400_000/.test(route))
    ok('route nằm TRƯỚC mọi route có tham số /:id', cr.indexOf(`router.get('/phieu-thu-kv'`) < cr.indexOf(`'/:id`))

    console.log(`\n${hong === 0 ? '✅' : '❌'} check-dong-tien-kv: ${dat} đạt, ${hong} hỏng`)
    if (hong) process.exit(1)
}
main().catch(e => { console.error('LỖI bộ kiểm:', e); process.exit(1) })
