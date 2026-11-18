/**
 * Kiểm PHIẾU THU KIOTVIET — npx tsx scripts/check-phieu-thu-kv.ts
 *
 * Vì sao có bộ này (23/10/2026): chủ shop so một khách HUTI — KiotViet "Nợ cần thu từ khách" và Kengi
 * "Lịch sử công nợ" cùng tổng nợ nhưng danh sách lệch hẳn:
 *   - phiếu thu TT… KiotViet phân bổ vào hoá đơn cũ ⇒ Kengi ghi thành Payment trên hoá đơn đó, mà
 *     Payment không có cột ngày ⇒ hiện ở NGÀY HOÁ ĐƠN, gộp vào dòng PT<số HĐ>;
 *   - phiếu thu mới không về (KiotViet không có webhook phiếu thu, lượt đêm không kéo sổ quỹ);
 *   - phiếu trả hàng KiotViet không được đọc.
 * Bộ này giữ các luật đã sửa:
 *   A. lib/phieuThuKiotViet.ts — đọc ngày KiotViet, ghi theo mẻ, thiếu bảng thì lùi êm;
 *   B. buildDebtHistory — mỗi mã TT một dòng ĐÚNG NGÀY, gộp mọi phần phân bổ; mã chưa biết ngày hiện như
 *      cũ; dòng trả nợ sổ quỹ mang mã thật; phiếu trả hàng KiotViet thành dòng trừ nợ; tổng không đổi;
 *   C. keoPhieuThuKhach — phiếu lạ ⇒ hỏi lại hoá đơn còn nợ cũ nhất, gắn đúng chỗ KiotViet phân bổ, dừng
 *      khi đủ; không thấy thì dòng trả nợ riêng đúng ngày; chạy thử không ghi gì; trần hỏi hoá đơn;
 *      HAI lượt chạy song song không ghi một phiếu thành hai dòng (giành bản nối trước).
 */
process.env.DATABASE_URL = process.env.DATABASE_URL_KIEM || 'postgresql://kiem@127.0.0.1:1/kiem'   // không ca nào được chạm DB thật

import {
    dongNgayTuKV, ghiNgayPhieuThu, docNgayPhieuThu, maTuDongTraNoKV, MA_PHIEU_THU_KV,
} from '../src/lib/phieuThuKiotViet'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

/* ─── Kho giả đủ dùng cho buildDebtHistory + syncInvoices (nhánh cập nhật) + syncCashflow ─────────── */
function khoGia(goc: {
    khach?: any[]; phieu?: any[]; tien?: any[]; noi?: any[]; dongNo?: any[]; tra?: any[]; ngay?: Record<string, string>
} = {}) {
    let seq = 0
    const id = (p: string) => `${p}${++seq}`
    const s = {
        khach: goc.khach ?? [], phieu: goc.phieu ?? [], tien: goc.tien ?? [], noi: goc.noi ?? [],
        dongNo: goc.dongNo ?? [], tra: goc.tra ?? [], ngay: new Map<string, Date>(Object.entries(goc.ngay ?? {}).map(([k, v]) => [k, new Date(v)])),
        ghiNgay: 0, sql: [] as string[],
    }
    const khopNoi = (w: any, r: any) => (!w.entity || (typeof w.entity === 'string' ? r.entity === w.entity : w.entity.in.includes(r.entity)))
        && (!w.kvId || (typeof w.kvId === 'string' ? r.kvId === w.kvId : w.kvId.in.includes(r.kvId)))
        && (!w.localId || (typeof w.localId === 'string' ? r.localId === w.localId : w.localId.in.includes(r.localId)))
    const db: any = {
        _s: s,
        customer: {
            findFirst: async ({ where }: any) => s.khach.find(k => k.id === where.id) ?? null,
            findUnique: async ({ where }: any) => s.khach.find(k => k.id === where.id) ?? null,
        },
        transaction: {
            findMany: async ({ where, include, take }: any) => {
                let ds = s.phieu.filter(t => {
                    if (where?.id?.in) return where.id.in.includes(t.id)
                    if (where?.OR) return where.OR.some((o: any) => o.customerId !== undefined && o.customerId === t.customerId)
                    return (!where?.customerId || t.customerId === where.customerId) && (!where?.status || t.status === where.status)
                }).sort((a, b) => a.createdAt - b.createdAt)
                if (take) ds = ds.slice(0, take)
                return ds.map(t => include?.payments ? { ...t, payments: s.tien.filter(p => p.transactionId === t.id) } : { ...t })
            },
            findUnique: async ({ where }: any) => s.phieu.find(t => (where.id && t.id === where.id) || (where.receiptNumber && t.receiptNumber === where.receiptNumber)) ?? null,
            update: async ({ where, data }: any) => { const t = s.phieu.find(x => x.id === where.id); Object.assign(t, data); return t },
        },
        payment: {
            findMany: async ({ where }: any) => s.tien.filter(p => (where.transactionId === undefined
                    || (where.transactionId?.in ? where.transactionId.in.includes(p.transactionId) : p.transactionId === where.transactionId))
                && (!where.reference?.in || where.reference.in.includes(p.reference))),
            findFirst: async ({ where }: any) => s.tien.find(p => p.reference === where.reference) ?? null,
            deleteMany: async ({ where }: any) => { const n = s.tien.length; s.tien = s.tien.filter(p => p.transactionId !== where.transactionId); return { count: n - s.tien.length } },
            createMany: async ({ data }: any) => { for (const d of data) s.tien.push({ id: id('pay'), ...d }); return { count: data.length } },
        },
        debtEntry: {
            findMany: async ({ where }: any) => s.dongNo.filter(e => where?.id?.in ? where.id.in.includes(e.id) : e.customerId === where.customerId),
            findUnique: async ({ where }: any) => s.dongNo.find(e => e.id === where.id) ?? null,
            create: async ({ data }: any) => { const e = { id: id('de'), ...data }; s.dongNo.push(e); return e },
            delete: async ({ where }: any) => { s.dongNo = s.dongNo.filter(e => e.id !== where.id) },
            updateMany: async ({ where, data }: any) => {
                const ds = s.dongNo.filter(e => e.id === where.id)
                for (const e of ds) {
                    if (data.amount?.decrement !== undefined) e.amount -= data.amount.decrement
                    else if (typeof data.amount === 'number') e.amount = data.amount
                }
                return { count: ds.length }
            },
            deleteMany: async ({ where }: any) => { const n = s.dongNo.length; s.dongNo = s.dongNo.filter(e => e.id !== where.id); return { count: n - s.dongNo.length } },
        },
        returnOrder: {
            findMany: async ({ where }: any) => s.tra.filter(r => r.reason === where.reason && r.status === where.status
                && where.OR.some((o: any) => (o.transactionId?.in ? o.transactionId.in.includes(r.transactionId) : (r.transactionId === null && r.customerName === o.customerName)))),
        },
        kiotVietMap: {
            findUnique: async ({ where }: any) => s.noi.find(r => r.entity === where.entity_kvId.entity && r.kvId === where.entity_kvId.kvId) ?? null,
            findMany: async ({ where }: any) => s.noi.filter(r => khopNoi(where, r)),
            create: async ({ data }: any) => {
                if (s.noi.some(r => r.entity === data.entity && r.kvId === data.kvId)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
                const r = { id: id('map'), ...data }; s.noi.push(r); return r
            },
            upsert: async ({ where, create, update }: any) => {
                const r = s.noi.find(x => x.entity === where.entity_kvId.entity && x.kvId === where.entity_kvId.kvId)
                if (r) Object.assign(r, update); else s.noi.push({ id: id('map'), ...create })
            },
            update: async ({ where, data }: any) => {
                const r = s.noi.find(x => x.entity === where.entity_kvId.entity && x.kvId === where.entity_kvId.kvId)
                if (!r) throw new Error('not found'); Object.assign(r, data); return r
            },
            updateMany: async ({ where, data }: any) => {
                const ds = s.noi.filter(r => r.entity === where.entity && r.kvId === where.kvId && r.localId === where.localId && r.syncedAt < where.syncedAt.lt)
                for (const r of ds) Object.assign(r, data)
                return { count: ds.length }
            },
            deleteMany: async ({ where }: any) => { const n = s.noi.length; s.noi = s.noi.filter(r => !(r.entity === where.entity && r.kvId === where.kvId && r.localId === where.localId)); return { count: n - s.noi.length } },
            delete: async ({ where }: any) => { s.noi = s.noi.filter(r => !(r.entity === where.entity_kvId.entity && r.kvId === where.entity_kvId.kvId)) },
        },
        repair: { findMany: async () => [], update: async () => ({}) },
        $transaction: async (fn: any) => fn(db),
        $queryRawUnsafe: async (sql: string, ...a: any[]) => {
            s.sql.push(sql)
            if (sql.includes('"PhieuThuKV"')) return (a[0] as string[]).filter(m => s.ngay.has(m)).map(m => ({ ma: m, ngay: s.ngay.get(m) }))
            return [{ ok: 1 }]
        },
        $executeRawUnsafe: async (sql: string, ...a: any[]) => {
            s.sql.push(sql)
            if (sql.startsWith('INSERT INTO "PhieuThuKV"')) {
                for (let i = 0; i < a.length; i += 5) { s.ngay.set(a[i], new Date(a[i + 1])); s.ghiNgay++ }
                return a.length / 5
            }
            return 0
        },
    }
    return db
}

async function main() {
    console.log('— A. Đọc ngày KiotViet —')
    const ttHd = dongNgayTuKV({ code: 'TT000142', amount: 1234567, status: 0, transDate: '2026-10-15T10:32:56.6070000' }, 'hoa-don')
    ok('1. payments[] hoá đơn có transDate → dòng ngày, KHÔNG mang tổng tiền (chỉ là phần phân bổ)', !!ttHd && ttHd.ma === 'TT000142' && ttHd.soTien === null && !isNaN(ttHd.ngay.getTime()), ttHd)
    const ttSq = dongNgayTuKV({ code: 'TT000238', amount: 2500000, status: 0, transDate: '2026-10-22T11:03:00.0000000', partnerId: 4100001, partnerType: 'C' }, 'so-quy')
    ok('2. sổ quỹ → có tổng tiền + id khách KiotViet', !!ttSq && ttSq.soTien === 2500000 && ttSq.kvKhachId === '4100001', ttSq)
    ok('3. phiếu ĐÃ HUỶ (status 1) → null', dongNgayTuKV({ code: 'TT1', status: 1, transDate: '2026-10-01T08:00:00' }, 'so-quy') === null)
    ok('4. thiếu ngày / ngày hỏng / thiếu mã → null', dongNgayTuKV({ code: 'TT1', status: 0 }, 'so-quy') === null
        && dongNgayTuKV({ code: 'TT1', status: 0, transDate: 'không phải ngày' }, 'so-quy') === null
        && dongNgayTuKV({ status: 0, transDate: '2026-10-01T08:00:00' }, 'so-quy') === null)
    ok('5. mã phiếu thu KiotViet: TT…, TTHD… khớp; PT tự đặt / "Thanh toán nợ" không khớp',
        MA_PHIEU_THU_KV.test('TT000238') && MA_PHIEU_THU_KV.test('TTHD000989') && !MA_PHIEU_THU_KV.test('PT026877') && !MA_PHIEU_THU_KV.test('Thanh toán nợ HĐ HD1'))
    ok('6. dòng trả nợ sổ quỹ → đúng mã KiotViet; dòng khác → null',
        maTuDongTraNoKV('Trả nợ — phiếu thu TT000238 (KiotViet)') === 'TT000238' && maTuDongTraNoKV('Thu nợ - phiếu thu abc') === null && maTuDongTraNoKV(null) === null)

    const dbNgay = khoGia()
    const nGhi = await ghiNgayPhieuThu(dbNgay, [
        dongNgayTuKV({ code: 'TT9', amount: 100, status: 0, transDate: '2026-10-01T08:00:00' }, 'hoa-don'),
        dongNgayTuKV({ code: 'TT9', amount: 900, status: 0, transDate: '2026-10-01T08:00:00', partnerId: 7, partnerType: 'C' }, 'so-quy'),
        null,
        ...Array.from({ length: 250 }, (_, i) => dongNgayTuKV({ code: `TTX${i}`, amount: 1, status: 0, transDate: '2026-10-02T09:00:00' }, 'hoa-don')),
    ])
    const insert = dbNgay._s.sql.filter((q: string) => q.startsWith('INSERT INTO "PhieuThuKV"'))
    const tao = dbNgay._s.sql.filter((q: string) => q.startsWith('CREATE TABLE IF NOT EXISTS "PhieuThuKV"'))
    ok('7. ghi theo mẻ ≤200 dòng (251 mã → 2 lệnh), trùng mã chỉ ghi một lần', nGhi === 251 && insert.length === 2, { nGhi, insert: insert.length })
    ok('8. tạo bảng lười đúng MỘT lần cho một client', tao.length === 1, tao.length)
    await ghiNgayPhieuThu(dbNgay, [dongNgayTuKV({ code: 'TT10', amount: 1, status: 0, transDate: '2026-10-03T09:00:00' }, 'so-quy')])
    ok('9. lần ghi sau không tạo bảng lại', dbNgay._s.sql.filter((q: string) => q.startsWith('CREATE TABLE')).length === 1)
    ok('10. không có dòng nào thì không chạm DB', (await ghiNgayPhieuThu(khoGia(), [null, null])) === 0)
    const thieuBang: any = { $queryRawUnsafe: async () => { throw Object.assign(new Error('relation "PhieuThuKV" does not exist'), { code: 'P2010', meta: { code: '42P01' } }) } }
    const m1 = await docNgayPhieuThu(thieuBang, ['TT1'])
    ok('11. bảng chưa có (chưa /admin/migrate) → Map rỗng, lịch sử lùi về cách cũ', m1.size === 0)
    ok('12. không có mã nào thì không truy vấn', (await docNgayPhieuThu({ $queryRawUnsafe: async () => { throw new Error('không được gọi') } } as any, [])).size === 0)

    console.log('— B. Lịch sử công nợ —')
    const { buildDebtHistory } = await import('../src/routes/customers')
    const KH = { id: 'k1', name: 'Cửa hàng A', phone: '0900', debt: 0 }
    const t = (iso: string) => new Date(iso)
    const phieu = [
        { id: 'h1', receiptNumber: 'HD001', customerId: 'k1', status: 'completed', total: 1000, createdAt: t('2026-08-01T01:00:00Z') },
        { id: 'h2', receiptNumber: 'HD002', customerId: 'k1', status: 'partial', total: 500, createdAt: t('2026-08-05T01:00:00Z') },
        { id: 'h3', receiptNumber: 'HD003', customerId: 'k1', status: 'partial', total: 300, createdAt: t('2026-09-01T01:00:00Z') },
    ]
    const tien = [
        { id: 'p1', transactionId: 'h1', type: 'cash', amount: 600, reference: 'TT100' },   // TT100 trả 15/09, chia 2 hoá đơn
        { id: 'p2', transactionId: 'h2', type: 'cash', amount: 200, reference: 'TT100' },
        { id: 'p3', transactionId: 'h1', type: 'cash', amount: 400, reference: 'TT200' },   // chưa biết ngày
        { id: 'p4', transactionId: 'h3', type: 'cash', amount: 100, reference: 'TTHD003' }, // thu lúc bán, giờ sớm hơn hoá đơn
    ]
    const dongNo = [{ id: 'de1', customerId: 'k1', type: 'payment', amount: 50, description: 'Trả nợ — phiếu thu TT300 (KiotViet)', createdAt: t('2026-09-20T03:00:00Z') }]
    const tra = [
        { id: 'r1', reason: 'Nhập từ KiotViet', status: 'refunded', transactionId: 'h2', customerName: 'Cửa hàng A', code: 'TH001', totalRefund: 80, refundAmount: 80, createdAt: t('2026-08-10T02:00:00Z') },
        { id: 'r2', reason: 'Nhập từ KiotViet', status: 'refunded', transactionId: 'h1', customerName: 'Cửa hàng A', code: 'TH002', totalRefund: 100, refundAmount: 30, createdAt: t('2026-08-11T02:00:00Z') },
        { id: 'r3', reason: 'Khách đổi ý', status: 'refunded', transactionId: 'h1', customerName: 'Cửa hàng A', code: 'TH003', totalRefund: 999, refundAmount: 999, createdAt: t('2026-08-12T02:00:00Z') },
    ]
    // Nợ thật = 1800 bán − 1300 thu trên hoá đơn − 50 sổ quỹ − 80 − 70 trả hàng = 300
    const db = khoGia({ khach: [{ ...KH, debt: 300 }], phieu, tien, dongNo, tra, ngay: { TT100: '2026-09-15T03:30:00Z', TTHD003: '2026-09-01T00:59:50Z' } })
    const { history: ls } = await buildDebtHistory(db, 'k1')
    const theoMa = (m: string) => ls.filter((h: any) => h.code === m)
    const tt100 = theoMa('TT100')
    ok('13. TT100 phân bổ vào 2 hoá đơn → MỘT dòng −800 đúng ngày trả 15/09', tt100.length === 1 && tt100[0].amount === -800 && tt100[0].date === '2026-09-15T03:30:00.000Z', tt100)
    ok('14. dòng phiếu thu KiotViet gắn nguon "kiotviet" (web ẩn nút Huỷ)', tt100[0]?.nguon === 'kiotviet')
    const pt1 = ls.filter((h: any) => h.id === 'h1-receipt')
    ok('15. TT200 CHƯA biết ngày → hiện như cũ: dòng PT ở ngày hoá đơn, chỉ phần chưa biết (−400)', pt1.length === 1 && pt1[0].amount === -400 && pt1[0].code === 'PT001', pt1)
    ok('16. dòng trả nợ sổ quỹ mang ĐÚNG mã KiotViet TT300', theoMa('TT300').length === 1 && theoMa('TT300')[0].amount === -50 && theoMa('TT300')[0].nguon === 'kiotviet')
    ok('17. phiếu trả KiotViet trừ thẳng nợ → dòng Trả hàng −80', theoMa('TH001')[0]?.amount === -80 && theoMa('TH001')[0]?.type === 'return')
    ok('18. phiếu trả có trả một phần tiền mặt (30/100) → chỉ trừ nợ phần còn lại −70', theoMa('TH002')[0]?.amount === -70, theoMa('TH002'))
    ok('19. phiếu trả TẠO TẠI KENGI không đọc ở đây (đã có DebtEntry riêng) — không đếm đôi', theoMa('TH003').length === 0)
    ok('20. không còn dòng "Dư nợ đầu kỳ" — lịch sử giải thích ĐỦ số dư', !ls.some((h: any) => h.id === 'opening-balance'), ls.find((h: any) => h.id === 'opening-balance'))
    ok('21. dòng mới nhất dư đúng bằng nợ hiện tại', Math.round(ls[0].balance) === 300, ls[0])
    const viTri = (m: string) => ls.findIndex((h: any) => h.code === m)
    ok('22. thu lúc bán TTHD003 giờ sớm hơn hoá đơn vẫn nằm SAU HD003 (không làm dư âm giả)', viTri('TTHD003') < viTri('HD003') && theoMa('TTHD003')[0].date === '2026-09-01T01:00:00.000Z', { tthd: viTri('TTHD003'), hd: viTri('HD003') })
    const tong = ls.filter((h: any) => h.id !== 'opening-balance').reduce((a: number, h: any) => a + h.amount, 0)
    ok('23. tổng phát sinh = số dư (chỉ đổi dòng/ngày, không đổi tiền)', Math.round(tong) === 300, tong)
    const { history: lsCu } = await buildDebtHistory(khoGia({ khach: [{ ...KH, debt: 300 }], phieu, tien, dongNo, tra }), 'k1')
    ok('24. chưa có ngày nào (bảng trống) → mọi phiếu TT hiện như cũ ở dòng PT, số dư cuối vẫn đúng',
        !lsCu.some((h: any) => h.code === 'TT100') && Math.round(lsCu[0].balance) === 300 && lsCu.some((h: any) => h.id === 'h1-receipt' && h.amount === -1000))

    console.log('— C. Kéo phiếu thu khách —')
    const { keoPhieuThuKhach, newCounters } = await import('../src/services/kiotvietSync')
    const datPhieu = () => [
        { id: 'a1', receiptNumber: 'HD101', customerId: 'k1', status: 'partial', total: 1000, amountReceived: 0, createdAt: t('2026-09-01T01:00:00Z') },
        { id: 'a2', receiptNumber: 'HD102', customerId: 'k1', status: 'partial', total: 500, amountReceived: 0, createdAt: t('2026-09-05T01:00:00Z') },
        { id: 'a3', receiptNumber: 'HD103', customerId: 'k1', status: 'partial', total: 400, amountReceived: 0, createdAt: t('2026-09-07T01:00:00Z') },
    ]
    const noiGoc = () => [
        { id: 'm0', entity: 'customer', kvId: '41', localId: 'k1', syncedAt: new Date() },
        { id: 'm1', entity: 'invoice', kvId: '9001', localId: 'a1', syncedAt: new Date() },
        { id: 'm2', entity: 'invoice', kvId: '9002', localId: 'a2', syncedAt: new Date() },
        { id: 'm3', entity: 'invoice', kvId: '9003', localId: 'a3', syncedAt: new Date() },
    ]
    const kvHoaDon: Record<string, any> = {
        HD101: { id: 9001, code: 'HD101', status: 1, total: 1000, customerId: 41, payments: [{ code: 'TT500', amount: 1000, status: 0, method: 'Cash', transDate: '2026-10-20T09:00:00' }] },
        HD102: { id: 9002, code: 'HD102', status: 1, total: 500, customerId: 41, payments: [{ code: 'TT500', amount: 200, status: 0, method: 'Cash', transDate: '2026-10-20T09:00:00' }] },
        HD103: { id: 9003, code: 'HD103', status: 1, total: 400, customerId: 41, payments: [] },
    }
    const soQuy = (ma: string, tienPhieu: number, khach = 41) => ({ id: Math.floor(Math.random() * 1e9), code: ma, amount: tienPhieu, status: 0, partnerType: 'C', partnerId: khach, cashGroup: 'Tiền khách trả', origin: 'Pay', transDate: '2026-10-20T09:00:00', partnerName: 'Cửa hàng A' })
    const opts = (apply = true): any => ({ apply, systemUserId: 'u1', invoicePaymentCodes: new Set<string>(), seededCustomerIds: new Set<string>(), daTuoiNo: new Set<string>() })
    const hoi: string[] = []
    const lay = async (ma: string) => { hoi.push(ma); return kvHoaDon[ma] ?? null }

    // C1: TT500 = 1.200, KiotViet chia 1.000 vào HD101 + 200 vào HD102
    const k1 = khoGia({ khach: [{ ...KH, debt: 300 }], phieu: datPhieu(), noi: noiGoc() })
    const c1 = newCounters()
    const kq1 = await keoPhieuThuKhach(k1, opts(), [soQuy('TT500', 1200)], c1, { nghiMs: 0 }, lay)
    const tt500 = k1._s.tien.filter((p: any) => p.reference === 'TT500')
    ok('25. phiếu lạ → hỏi hoá đơn còn nợ CŨ NHẤT trước, dừng khi đã thấy đủ 1.200 (không hỏi HD103)', hoi.join(',') === 'HD101,HD102', hoi)
    ok('26. tiền gắn đúng hoá đơn KiotViet đã phân bổ (1.000 + 200)', tt500.length === 2 && tt500.reduce((a: number, p: any) => a + p.amount, 0) === 1200, tt500)
    ok('27. hoá đơn đủ tiền chuyển "completed", hoá đơn còn thiếu giữ "partial"', k1._s.phieu.find((x: any) => x.id === 'a1').status === 'completed' && k1._s.phieu.find((x: any) => x.id === 'a2').status === 'partial')
    ok('28. đã gắn hoá đơn thì KHÔNG ghi thêm dòng trả nợ riêng', k1._s.dongNo.length === 0 && kq1.conLa.length === 0, { dongNo: k1._s.dongNo, conLa: kq1.conLa })
    ok('29. ngày thật của TT500 được ghi', k1._s.ngay.has('TT500'))
    ok('30. hai hoá đơn được dựng lại phiếu thu', kq1.hoaDonCapNhat === 2, kq1)

    // C2: chạy lại — đã có rồi thì không hỏi KiotViet, không ghi gì thêm (hội tụ)
    hoi.length = 0
    const kq2 = await keoPhieuThuKhach(k1, opts(), [soQuy('TT500', 1200)], newCounters(), { nghiMs: 0 }, lay)
    ok('31. chạy lại lần hai: phiếu đã có ⇒ 0 phiếu lạ, không hỏi hoá đơn, không thêm Payment', kq2.phieuLa === 0 && hoi.length === 0 && k1._s.tien.filter((p: any) => p.reference === 'TT500').length === 2, { kq2, hoi })

    // C3: phiếu không nằm trên hoá đơn nào (KiotViet thu chung) → dòng trả nợ riêng đúng ngày
    hoi.length = 0
    const k3 = khoGia({ khach: [{ ...KH, debt: 300 }], phieu: datPhieu(), noi: noiGoc() })
    const kq3 = await keoPhieuThuKhach(k3, opts(), [soQuy('TT600', 250)], newCounters(), { nghiMs: 0 }, async (ma) => ({ ...kvHoaDon[ma], payments: [] }))
    const de3 = k3._s.dongNo.filter((e: any) => e.description === 'Trả nợ — phiếu thu TT600 (KiotViet)')
    ok('32. không thấy trên hoá đơn nào → MỘT dòng trả nợ riêng 250, ngày theo KiotViet', de3.length === 1 && de3[0].amount === 250 && de3[0].createdAt.getTime() === new Date('2026-10-20T09:00:00').getTime(), de3)
    const map3 = k3._s.noi.find((r: any) => r.entity === 'debtPayment' && r.kvId === 'TT600')
    ok('33. bản nối trỏ đúng dòng trả nợ (không còn chỗ giữ rỗng)', map3?.localId === de3[0]?.id, map3)
    ok('34. báo mã còn lạ để nhật ký nói ra', kq3.conLa.join() === 'TT600', kq3.conLa)

    // C4: HAI lượt song song cùng một phiếu lạ (webhook + nhịp 2 giờ trên hai bản Cloud Run)
    const k4 = khoGia({ khach: [{ ...KH, debt: 300 }], phieu: datPhieu(), noi: noiGoc() })
    const khongCo = async (ma: string) => ({ ...kvHoaDon[ma], payments: [] })
    await Promise.all([
        keoPhieuThuKhach(k4, opts(), [soQuy('TT700', 90)], newCounters(), { nghiMs: 0 }, khongCo),
        keoPhieuThuKhach(k4, opts(), [soQuy('TT700', 90)], newCounters(), { nghiMs: 0 }, khongCo),
    ])
    ok('35. hai lượt song song → vẫn MỘT dòng trả nợ (giành bản nối trước khi tạo)', k4._s.dongNo.filter((e: any) => e.description.includes('TT700')).length === 1, k4._s.dongNo)

    // C5: phiếu đã nằm trên hoá đơn (Payment) mà THIẾU bản nối — hoá đơn nhập bằng bản cũ
    const k5 = khoGia({ khach: [{ ...KH, debt: 300 }], phieu: datPhieu(), noi: noiGoc(), tien: [{ id: 'q1', transactionId: 'a1', type: 'cash', amount: 300, reference: 'TT800' }] })
    hoi.length = 0
    await keoPhieuThuKhach(k5, opts(), [soQuy('TT800', 300)], newCounters(), { nghiMs: 0 }, lay)
    ok('36. có Payment.reference thiếu bản nối → không hỏi hoá đơn, không ghi dòng trả nợ đôi', hoi.length === 0 && k5._s.dongNo.length === 0)

    // C6: chạy thử — không ghi gì
    const k6 = khoGia({ khach: [{ ...KH, debt: 300 }], phieu: datPhieu(), noi: noiGoc() })
    const truoc = JSON.stringify({ t: k6._s.tien, d: k6._s.dongNo, n: k6._s.noi.length, p: k6._s.phieu })
    const c6 = newCounters()
    const kq6 = await keoPhieuThuKhach(k6, opts(false), [soQuy('TT500', 1200), soQuy('TT600', 250)], c6, { nghiMs: 0 }, async (ma) => kvHoaDon[ma])
    ok('37. chạy thử: không đổi Payment / dòng nợ / bản nối / phiếu, không ghi ngày', truoc === JSON.stringify({ t: k6._s.tien, d: k6._s.dongNo, n: k6._s.noi.length, p: k6._s.phieu }) && k6._s.ghiNgay === 0)
    ok('38. chạy thử vẫn đếm đúng: TT500 sẽ gắn hoá đơn, TT600 sẽ thành dòng trả nợ', kq6.phieuLa === 2 && kq6.conLa.join() === 'TT600' && c6.created === 1, { kq6, created: c6.created })

    // C7: trần hỏi hoá đơn — phần vượt trần đi đường dòng trả nợ riêng (vẫn đúng ngày) và báo hết ngân sách
    const k7 = khoGia({ khach: [{ ...KH, debt: 300 }, { id: 'k2', name: 'B', phone: null, debt: 0 }], phieu: [...datPhieu(), { id: 'b1', receiptNumber: 'HD201', customerId: 'k2', status: 'partial', total: 50, amountReceived: 0, createdAt: t('2026-09-02T01:00:00Z') }], noi: [...noiGoc(), { id: 'm9', entity: 'customer', kvId: '42', localId: 'k2', syncedAt: new Date() }, { id: 'm10', entity: 'invoice', kvId: '9201', localId: 'b1', syncedAt: new Date() }] })
    const kq7 = await keoPhieuThuKhach(k7, opts(), [soQuy('TT901', 10), soQuy('TT902', 20, 42)], newCounters(), { nghiMs: 0, hoaDonToiDa: 1 }, async (ma) => ({ ...(kvHoaDon[ma] ?? { id: 1, code: ma, status: 1, total: 50, customerId: 42 }), payments: [] }))
    ok('39. chạm trần hỏi hoá đơn → báo hetNganSach, phiếu còn lại vẫn có dòng trả nợ đúng ngày', kq7.hetNganSach && kq7.hoaDonHoiLai === 1 && k7._s.dongNo.length === 2, { kq7, dongNo: k7._s.dongNo.length })

    // C8 (12/11/2026, HUTI HD032073): phiếu thu bị HUỶ bên KiotViet mà Kengi còn giữ trên hoá đơn ⇒ gỡ
    const huy = (ma: string, tienPhieu: number) => ({ ...soQuy(ma, tienPhieu), status: 1, statusValue: 'Đã hủy' })
    const datDaThu = () => [{ id: 'a1', receiptNumber: 'HD101', customerId: 'k1', status: 'completed', total: 1000, amountReceived: 1000, createdAt: t('2026-09-01T01:00:00Z') }]
    const kvHuy = { HD101: { id: 9001, code: 'HD101', status: 1, total: 1000, totalPayment: 0, customerId: 41, payments: [{ code: 'TTHD101', amount: 1000, status: 1, statusValue: 'Đã hủy', method: 'Cash', transDate: '2026-10-20T09:00:00' }] } }
    const k8 = khoGia({ khach: [{ ...KH, debt: 0 }], phieu: datDaThu(), noi: noiGoc(), tien: [{ id: 'q8', transactionId: 'a1', type: 'cash', amount: 1000, reference: 'TTHD101' }] })
    hoi.length = 0
    const kq8 = await keoPhieuThuKhach(k8, opts(), [huy('TTHD101', 1000)], newCounters(), { nghiMs: 0 }, async (ma) => { hoi.push(ma); return (kvHuy as any)[ma] ?? null })
    const a1Sau = k8._s.phieu.find((x: any) => x.id === 'a1')
    ok('44. phiếu thu đã huỷ bên KiotViet còn nằm trên hoá đơn Kengi ⇒ hỏi lại hoá đơn, gỡ Payment, đơn về "partial" thu 0',
        hoi.join() === 'HD101' && k8._s.tien.filter((p: any) => p.reference === 'TTHD101').length === 0 && a1Sau.amountReceived === 0 && a1Sau.status === 'partial' && kq8.hoaDonGoPhieuHuy === 1,
        { hoi, tien: k8._s.tien, a1Sau, kq8 })
    ok('45. phiếu huỷ KHÔNG bị ghi thành dòng trả nợ / không bị coi là phiếu lạ', k8._s.dongNo.length === 0 && kq8.phieuLa === 0)

    const k9 = khoGia({ khach: [{ ...KH, debt: 0 }], phieu: datDaThu(), noi: noiGoc(), tien: [{ id: 'q9', transactionId: 'a1', type: 'cash', amount: 1000, reference: 'TTHD101' }] })
    const kvChuaHuy = { HD101: { ...kvHuy.HD101, totalPayment: 1000, payments: [{ ...kvHuy.HD101.payments[0], status: 0, statusValue: 'Đã thanh toán' }] } }
    await keoPhieuThuKhach(k9, opts(), [huy('TTHD101', 1000)], newCounters(), { nghiMs: 0 }, async (ma) => (kvChuaHuy as any)[ma] ?? null)
    ok('46. sổ quỹ nói huỷ mà CHÍNH hoá đơn KiotViet vẫn ghi phiếu còn hiệu lực ⇒ KHÔNG đụng (để lượt sau)',
        k9._s.tien.length === 1 && k9._s.phieu[0].amountReceived === 1000 && k9._s.phieu[0].status === 'completed')

    const k10 = khoGia({ khach: [{ ...KH, debt: 0 }], phieu: datDaThu(), noi: noiGoc(), tien: [{ id: 'q10', transactionId: 'a1', type: 'cash', amount: 1000, reference: 'TTHD101' }] })
    hoi.length = 0
    await keoPhieuThuKhach(k10, opts(), [huy('TT999', 500)], newCounters(), { nghiMs: 0 }, async (ma) => { hoi.push(ma); return null })
    ok('47. phiếu huỷ mà Kengi không giữ ở đâu ⇒ không hỏi KiotViet, không đổi gì', hoi.length === 0 && k10._s.tien.length === 1)

    const k11 = khoGia({ khach: [{ ...KH, debt: 0 }], phieu: datDaThu(), noi: noiGoc(), tien: [{ id: 'q11', transactionId: 'a1', type: 'cash', amount: 1000, reference: 'TTHD101' }] })
    await keoPhieuThuKhach(k11, opts(false), [huy('TTHD101', 1000)], newCounters(), { nghiMs: 0 }, async (ma) => (kvHuy as any)[ma] ?? null)
    ok('48. chạy thử ⇒ không gỡ gì', k11._s.tien.length === 1 && k11._s.phieu[0].amountReceived === 1000)

    // C9: tổng ĐÃ khớp (huỷ TT…489 rồi thu lại TT…490 cùng số) nhưng Kengi còn giữ dòng mang mã huỷ ⇒ vẫn phải dựng lại
    const kvThuLai = { HD101: { ...kvHuy.HD101, totalPayment: 1000, payments: [kvHuy.HD101.payments[0], { code: 'TT490', amount: 1000, status: 0, method: 'Cash', transDate: '2026-10-20T09:01:00' }] } }
    const k12 = khoGia({ khach: [{ ...KH, debt: 0 }], phieu: datDaThu(), noi: noiGoc(), tien: [{ id: 'q12', transactionId: 'a1', type: 'cash', amount: 1000, reference: 'TTHD101' }] })
    const kq12 = await keoPhieuThuKhach(k12, opts(), [huy('TTHD101', 1000)], newCounters(), { nghiMs: 0 }, async (ma) => (kvThuLai as any)[ma] ?? null)
    const tien12 = k12._s.tien.filter((p: any) => p.transactionId === 'a1')
    ok('49. tổng đã khớp nhưng còn dòng mang mã huỷ ⇒ dựng lại: chỉ còn TT490, đơn vẫn đủ tiền',
        tien12.length === 1 && tien12[0].reference === 'TT490' && k12._s.phieu[0].amountReceived === 1000 && k12._s.phieu[0].status === 'completed' && kq12.hoaDonCapNhat === 1,
        { tien12, kq12 })

    console.log('— D. Phiếu chia NHIỀU hoá đơn mà Kengi mới giữ một phần (18/11/2026) —')
    const tienMa = (k: any, m: string) => k._s.tien.filter((p: any) => p.reference === m).reduce((a: number, p: any) => a + p.amount, 0)
    const dongMa = (k: any, m: string) => k._s.dongNo.filter((e: any) => e.description === `Trả nợ — phiếu thu ${m} (KiotViet)`)
    const kvTra = (ma: string, tong: number, ps: [string, number][]) => ({
        id: 9000 + Number(ma.slice(2)), code: ma, status: 1, total: tong, customerId: 41,
        totalPayment: ps.reduce((a, [, x]) => a + x, 0),
        payments: ps.map(([m, x]) => ({ code: m, amount: x, status: 0, method: 'Cash', transDate: '2026-10-20T09:00:00' })),
    })
    const datPhieuThu = (thu: Record<string, number>) => datPhieu().map((x: any) => {
        const a = thu[x.receiptNumber] || 0
        return { ...x, amountReceived: a, status: a >= x.total ? 'completed' : 'partial' }
    })

    // D1 — phần KiotViet chia vào hoá đơn Kengi KHÔNG giữ (hoá đơn "Đang xử lý"): Kengi có 600/1.000 trên HD101
    {
        const kv = { HD101: kvTra('HD101', 1000, [['TT950', 600]]), HD102: kvTra('HD102', 500, []), HD103: kvTra('HD103', 400, []) }
        const k = khoGia({ khach: [{ ...KH, debt: 300 }], phieu: datPhieuThu({ HD101: 600 }), noi: noiGoc(), tien: [{ id: 'q950', transactionId: 'a1', type: 'cash', amount: 600, reference: 'TT950' }] })
        hoi.length = 0
        const kq = await keoPhieuThuKhach(k, opts(), [soQuy('TT950', 1000)], newCounters(), { nghiMs: 0 }, async (ma) => { hoi.push(ma); return (kv as any)[ma] ?? null })
        const de = dongMa(k, 'TT950')
        ok('50. phiếu 1.000 mà Kengi mới giữ 600 trên hoá đơn ⇒ coi là CHƯA ĐỦ (bản cũ: có một mẩu là bỏ qua cả phiếu)', kq.phieuLa === 1 && hoi.length === 3, { kq, hoi })
        ok('51. phần 400 không thấy trên hoá đơn Kengi nào ⇒ MỘT dòng trả nợ riêng 400 (không phải 1.000), mẩu 600 giữ nguyên',
            de.length === 1 && de[0].amount === 400 && tienMa(k, 'TT950') === 600, { de, tien: tienMa(k, 'TT950') })
        ok('52. Σ mẩu + dòng riêng = đúng số sổ quỹ KiotViet; báo phanDu 0 → 400 kèm phần trên hoá đơn',
            tienMa(k, 'TT950') + de[0]?.amount === 1000 && JSON.stringify(kq.phanDu) === JSON.stringify([{ ma: 'TT950', soTienKV: 1000, trenHoaDon: 600, truoc: 0, sau: 400 }]) && kq.conLa.join() === 'TT950', kq)
        hoi.length = 0
        const kq2 = await keoPhieuThuKhach(k, opts(), [soQuy('TT950', 1000)], newCounters(), { nghiMs: 0 }, async (ma) => { hoi.push(ma); return (kv as any)[ma] ?? null })
        ok('53. chạy lại: đã đủ (mẩu + dòng riêng) ⇒ 0 phiếu lạ, không hỏi KiotViet, không đổi dòng (hội tụ)',
            kq2.phieuLa === 0 && hoi.length === 0 && dongMa(k, 'TT950').length === 1 && dongMa(k, 'TT950')[0].amount === 400 && (kq2.phanDu || []).length === 0, { kq2, hoi })
    }

    // D2 — mẩu nằm trên hoá đơn Kengi CÓ giữ mà chưa gắn (dòng trả nợ riêng từng bị xoá cả khi mới một mẩu về)
    {
        const kv = { HD101: kvTra('HD101', 1000, [['TT960', 300]]), HD102: kvTra('HD102', 500, [['TT960', 500]]), HD103: kvTra('HD103', 400, [['TT960', 100]]) }
        const k = khoGia({ khach: [{ ...KH, debt: 300 }], phieu: datPhieuThu({ HD103: 100 }), noi: noiGoc(), tien: [{ id: 'q960', transactionId: 'a3', type: 'cash', amount: 100, reference: 'TT960' }] })
        hoi.length = 0
        const kq = await keoPhieuThuKhach(k, opts(), [soQuy('TT960', 900)], newCounters(), { nghiMs: 0 }, async (ma) => { hoi.push(ma); return (kv as any)[ma] ?? null })
        ok('54. phiếu 900, Kengi giữ 100 ⇒ hỏi hoá đơn cũ nhất, dừng khi thấy ĐỦ phần còn thiếu 800 (HD101+HD102, không hỏi HD103)', hoi.join() === 'HD101,HD102' && kq.phieuLa === 1, { hoi, kq })
        ok('55. gắn đủ 3 mẩu = 900, KHÔNG ghi dòng trả nợ riêng, không còn mã lạ',
            tienMa(k, 'TT960') === 900 && dongMa(k, 'TT960').length === 0 && kq.conLa.length === 0 && kq.hoaDonCapNhat === 2, { tien: tienMa(k, 'TT960'), kq })
    }

    // D3 — dòng trả nợ riêng ghi cả phiếu (sổ quỹ tới trước) rồi các mẩu về DẦN qua hoá đơn ⇒ trừ đúng phần, đủ mới xoá
    {
        const { syncInvoices } = await import('../src/services/kiotvietSync')
        const k = khoGia({
            khach: [{ ...KH, debt: 300 }], phieu: datPhieu(),
            noi: [...noiGoc(), { id: 'm970', entity: 'debtPayment', kvId: 'TT970', localId: 'de970', syncedAt: new Date() }],
            dongNo: [{ id: 'de970', customerId: 'k1', type: 'payment', amount: 800, description: 'Trả nợ — phiếu thu TT970 (KiotViet)', createdAt: t('2026-10-20T02:00:00Z') }],
        })
        const capNhat = (hd: any) => syncInvoices(k, [hd], { ...opts(), rebuildLines: false, updateOnly: true }, newCounters())
        await capNhat(kvTra('HD101', 1000, [['TT970', 300]]))
        ok('56. mẩu 300 về trên HD101 ⇒ dòng trả nợ riêng còn 500 (bản cũ XOÁ CẢ dòng 800 ⇒ mất 500 khỏi sổ)',
            dongMa(k, 'TT970').length === 1 && dongMa(k, 'TT970')[0].amount === 500 && k._s.noi.some((r: any) => r.entity === 'debtPayment' && r.kvId === 'TT970'), k._s.dongNo)
        await capNhat(kvTra('HD101', 1000, [['TT970', 300], ['TT971', 100]]))
        ok('57. hoá đơn dựng lại vì phiếu KHÁC (TT971) mà mẩu TT970 không đổi ⇒ dòng riêng TT970 giữ nguyên 500',
            dongMa(k, 'TT970')[0]?.amount === 500 && tienMa(k, 'TT971') === 100, k._s.dongNo)
        await capNhat(kvTra('HD102', 500, [['TT970', 500]]))
        ok('58. mẩu cuối 500 về trên HD102 ⇒ đủ 800 trên hoá đơn ⇒ xoá dòng riêng + bản nối (không đếm hai lần)',
            dongMa(k, 'TT970').length === 0 && !k._s.noi.some((r: any) => r.entity === 'debtPayment' && r.kvId === 'TT970') && tienMa(k, 'TT970') === 800, { dongNo: k._s.dongNo, tien: tienMa(k, 'TT970') })
    }

    // D4 — sổ quỹ dọn dòng riêng cũ ghi CẢ phiếu trong khi mẩu đã nằm trên hoá đơn (đếm đôi)
    {
        const k = khoGia({
            khach: [{ ...KH, debt: 300 }], phieu: datPhieuThu({ HD101: 400, HD102: 500 }), noi: [...noiGoc(),
                { id: 'm980', entity: 'debtPayment', kvId: 'TT980', localId: 'de980', syncedAt: new Date() },
                { id: 'm981', entity: 'debtPayment', kvId: 'TT981', localId: 'de981', syncedAt: new Date() }],
            tien: [{ id: 'q980', transactionId: 'a1', type: 'cash', amount: 400, reference: 'TT980' }, { id: 'q981', transactionId: 'a2', type: 'cash', amount: 500, reference: 'TT981' }],
            dongNo: [
                { id: 'de980', customerId: 'k1', type: 'payment', amount: 1000, description: 'Trả nợ — phiếu thu TT980 (KiotViet)', createdAt: t('2026-10-20T02:00:00Z') },
                { id: 'de981', customerId: 'k1', type: 'payment', amount: 500, description: 'Trả nợ — phiếu thu TT981 (KiotViet)', createdAt: t('2026-10-20T02:00:00Z') }],
        })
        hoi.length = 0
        const kq = await keoPhieuThuKhach(k, opts(), [soQuy('TT980', 1000), soQuy('TT981', 500)], newCounters(), { nghiMs: 0 }, async (ma) => { hoi.push(ma); return null })
        ok('59. dòng riêng 1.000 + mẩu 400 (đếm đôi) ⇒ sửa dòng riêng thành 600; không hỏi KiotViet',
            dongMa(k, 'TT980')[0]?.amount === 600 && hoi.length === 0, { dongNo: k._s.dongNo, hoi })
        ok('60. dòng riêng 500 trong khi mẩu đã đủ 500 ⇒ gỡ dòng riêng + bản nối',
            dongMa(k, 'TT981').length === 0 && !k._s.noi.some((r: any) => r.kvId === 'TT981' && r.entity === 'debtPayment'), k._s.dongNo)
        ok('61. báo phanDu cho cả hai (1.000 → 600, 500 → 0)',
            JSON.stringify((kq.phanDu || []).map((d: any) => [d.ma, d.truoc, d.sau])) === JSON.stringify([['TT980', 1000, 600], ['TT981', 500, 0]]), kq.phanDu)
    }

    // D5 — CHẠY THỬ D1 + D2 cùng lúc: không ghi gì mà báo đúng như chạy thật
    {
        const kv = { HD101: kvTra('HD101', 1000, [['TT950', 600], ['TT960', 300]]), HD102: kvTra('HD102', 500, [['TT960', 500]]), HD103: kvTra('HD103', 400, [['TT960', 100]]) }
        const k = khoGia({
            khach: [{ ...KH, debt: 300 }], phieu: datPhieuThu({ HD101: 600, HD103: 100 }), noi: noiGoc(),
            tien: [{ id: 'q950', transactionId: 'a1', type: 'cash', amount: 600, reference: 'TT950' }, { id: 'q960', transactionId: 'a3', type: 'cash', amount: 100, reference: 'TT960' }],
        })
        const truoc = JSON.stringify({ t: k._s.tien, d: k._s.dongNo, n: k._s.noi, p: k._s.phieu })
        const c = newCounters()
        const kq = await keoPhieuThuKhach(k, opts(false), [soQuy('TT950', 1000), soQuy('TT960', 900)], c, { nghiMs: 0 }, async (ma) => (kv as any)[ma] ?? null)
        ok('62. chạy thử: không đổi Payment / dòng nợ / bản nối / phiếu', truoc === JSON.stringify({ t: k._s.tien, d: k._s.dongNo, n: k._s.noi, p: k._s.phieu }))
        ok('63. chạy thử báo đúng: TT950 sẽ có dòng riêng 400; TT960 gắn đủ hoá đơn nên KHÔNG có dòng riêng ảo',
            c.created === 1 && JSON.stringify((kq.phanDu || []).map((d: any) => [d.ma, d.trenHoaDon, d.sau])) === JSON.stringify([['TT950', 600, 400]]) && kq.conLa.join() === 'TT950',
            { created: c.created, phanDu: kq.phanDu, conLa: kq.conLa })
    }

    // D6 — bản nối còn mà dòng trả nợ riêng ĐÃ XOÁ có chủ đích (khoá sổ trước 2026, gộp dư nợ đầu kỳ) ⇒ không đụng
    {
        const k = khoGia({ khach: [{ ...KH, debt: 300 }], phieu: datPhieu(), noi: [...noiGoc(), { id: 'm990', entity: 'debtPayment', kvId: 'TT990', localId: 'de-da-xoa', syncedAt: new Date() }] })
        hoi.length = 0
        const kq = await keoPhieuThuKhach(k, opts(), [soQuy('TT990', 1000)], newCounters(), { nghiMs: 0 }, async (ma) => { hoi.push(ma); return null })
        ok('64. dòng đã khoá sổ ⇒ không coi là lạ, không hỏi KiotViet, không ghi lại dòng trả nợ, giữ bản nối',
            kq.phieuLa === 0 && hoi.length === 0 && k._s.dongNo.length === 0 && k._s.noi.some((r: any) => r.kvId === 'TT990'), { kq, hoi })
    }

    // D7 — Lịch sử công nợ: phiếu có mẩu trên hoá đơn + phần dòng riêng ⇒ MỘT dòng đủ tiền
    {
        const ph = [{ id: 'h1', receiptNumber: 'HD001', customerId: 'k1', status: 'completed', total: 600, createdAt: t('2026-08-01T01:00:00Z') }]
        const kD = khoGia({
            khach: [{ ...KH, debt: 0 }], phieu: ph,
            tien: [{ id: 'p1', transactionId: 'h1', type: 'cash', amount: 600, reference: 'TT955' }],
            dongNo: [{ id: 'de955', customerId: 'k1', type: 'payment', amount: 400, description: 'Trả nợ — phiếu thu TT955 (KiotViet)', createdAt: t('2026-09-15T03:30:00Z') }],
            ngay: { TT955: '2026-09-15T03:30:00Z' },
        })
        const { history: lsD } = await buildDebtHistory(kD, 'k1')
        const dong955 = lsD.filter((h: any) => h.code === 'TT955')
        ok('65. Lịch sử công nợ: TT955 (600 trên hoá đơn + 400 dòng riêng) ⇒ MỘT dòng −1.000 đúng ngày thu', dong955.length === 1 && dong955[0].amount === -1000 && dong955[0].date === '2026-09-15T03:30:00.000Z', dong955)
    }


    // ─── Gom webhook khách dồn dập mà không làm rơi phiếu (11/11/2026) ───
    {
        const { taoBoGomKeoPhieuThu } = await import('../src/services/kiotvietSync')
        const g = taoBoGomKeoPhieuThu()
        const a1 = g.nhan(['r:1'])
        const a2 = g.nhan(['r:1', 'r:2'])
        ok('40. webhook đầu ⇒ xếp lượt kéo; webhook thứ hai của CÙNG khách khi lượt kia CHƯA chạy ⇒ không xếp thêm (khách khác vẫn xếp)',
            JSON.stringify(a1) === '["r:1"]' && JSON.stringify(a2) === '["r:2"]' && g.soDangCho === 2)
        g.batDau(['r:1'])
        const a3 = g.nhan(['r:1'])
        ok('41. lượt kéo ĐÃ BẮT ĐẦU chạy ⇒ webhook tới thêm của khách đó được xếp MỘT lượt mới (phiếu nhập lại sau lần đọc sổ quỹ không bị rơi)',
            JSON.stringify(a3) === '["r:1"]')
        ok('42. … và webhook thứ ba trong lúc lượt mới còn chờ ⇒ không xếp nữa; khoá rỗng / trùng trong một payload bị gộp',
            g.nhan(['r:1']).length === 0 && JSON.stringify(g.nhan(['', 'r:9', 'r:9'])) === '["r:9"]')
        const nguonRoute = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'routes', 'kiotviet.ts'), 'utf8')
        ok('43. đường webhook: nhả khoá NGAY KHI lượt bắt đầu (trước khi đọc sổ quỹ) và không còn luật "bỏ trong 20 giây"',
            /boGomPhieuThu\.batDau\(khoa\)[^\n]*\n\s+return keoPhieuThuTheoKhach\(sp, opts, ids, c\)/.test(nguonRoute.replace(/\r\n/g, '\n')) && !/20_000/.test(nguonRoute.slice(nguonRoute.indexOf('keoPhieuThuSauWebhookKhach'), nguonRoute.indexOf('async function logWebhook'))))
    }

    console.log(`\n${dat} đạt, ${hong} hỏng`)
    process.exit(hong ? 1 : 0)
}
main().catch((e) => { console.error('LỖI:', e?.stack || e); process.exit(1) })
