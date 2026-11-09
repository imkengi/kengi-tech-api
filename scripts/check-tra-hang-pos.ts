/**
 * Bộ soát TRẢ HÀNG Ở QUẦY — PUT /api/transactions/:id/return (09/11/2026).
 *   npx tsx scripts/check-tra-hang-pos.ts
 *
 * Sự cố (có từ 03/03/2026, commit 7f516c9): handler ghi XONG mọi thứ (đổi trạng thái phiếu, lập phiếu RT-, cộng
 * lại tồn kho, trừ doanh số + nợ khách) rồi mới dựng câu trả lời bằng `JSON.parse(returnOrder.items)`. Nhưng
 * `ReturnOrder.items` là QUAN HỆ (ReturnItem[]), không phải cột chuỗi — `prisma.returnOrder.create` không `include`
 * thì trả về KHÔNG có khoá `items` ⇒ `JSON.parse(undefined)` ném SyntaxError ⇒ khối catch trả 500.
 * Hậu quả: trả hàng thành công mà máy POS báo "Lỗi khi xử lý trả hàng" ⇒ thu ngân bấm lại ⇒ trả MỘT PHẦN thì
 * phiếu vẫn 'completed' nên lần hai lọt qua ⇒ cộng tồn kho hai lần, trừ doanh số khách hai lần.
 *
 * Không DB: lấy đúng các bước của tuyến trong router, bỏ authMiddleware (gắn sẵn req.user), chạy requirePermission
 * + handler thật với storePrisma giả. Giả lập đúng hành vi Prisma: `create` KHÔNG include ⇒ bỏ mọi quan hệ lồng.
 */
import transactionsRouter from '../src/routes/transactions'

let loi = 0, tong = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    tong++
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}

const cacBuoc = (router: any, method: string, duong: string): Function[] =>
    router.stack.find((l: any) => l.route?.path === duong && l.route.methods[method])?.route.stack.map((l: any) => l.handle) || []

/** Bỏ khoá quan hệ lồng ({create}/{connect}) như Prisma làm khi không `include`. */
const voHuongQuanHe = (data: any) => Object.fromEntries(Object.entries(data || {}).filter(([, v]) =>
    !(v && typeof v === 'object' && !(v instanceof Date) && ('create' in (v as any) || 'connect' in (v as any) || 'createMany' in (v as any)))))

/** `traTruoc` = các phiếu RT- đã lập trước cho hoá đơn (findMany / findFirst của returnOrder trả về). */
function taoPrismaGia(phieu: any, khach: any, traTruoc: any[] = []) {
    const goi: string[] = []
    const ghi = (s: string) => goi.push(s)
    const mau: Record<string, Record<string, (a?: any) => any>> = {
        transaction: {
            findUnique: () => phieu,
            update: (a: any) => ({ ...phieu, ...a.data, returnedAt: new Date(), items: phieu.items, payments: phieu.payments }),
        },
        user: { findUnique: () => ({ id: 'u1', name: 'Thu Ngân' }) },
        returnOrder: {
            create: (a: any) => ({ id: 'ro1', createdAt: new Date(), updatedAt: new Date(), ...voHuongQuanHe(a.data) }),
            findMany: () => traTruoc,
            findFirst: () => traTruoc[0] || null,
        },
        product: {
            update: (a: any) => ({ id: a.where.id, sku: 'A1', name: 'Hàng A', stock: 10, costPrice: 50000 }),
            findUnique: () => ({ name: 'Hàng A', sku: 'A1', costPrice: 50000 }),
        },
        branch: { findFirst: () => null, findUnique: () => null },
        warehouse: { findFirst: () => ({ id: 'w1', type: 'main', isDefault: true }), create: () => ({ id: 'w1' }) },
        warehouseStock: { upsert: () => ({}), findUnique: () => null, update: () => ({}) },
        inventoryTransaction: { create: () => ({}) },
        customer: { findUnique: () => khach, update: () => khach },
        debtEntry: { create: () => ({}) },
        webhookEndpoint: { findMany: () => [] },
    }
    const prisma: any = new Proxy({}, {
        get: (_m, model: string) => {
            if (model === '$executeRawUnsafe') return async () => 0
            if (model === '$queryRawUnsafe') return async (sql: string) => /is_called/.test(sql) ? [{ is_called: true }] : [{ n: 7 }]
            // Huỷ phiếu ghi trong $transaction — bộ soát chỉ cần biết đã QUA chốt chặn ⇒ dừng có chủ ý ở đây
            if (model === '$transaction') return async () => { ghi('$transaction'); throw new Error('prisma giả dừng ở $transaction (cố ý — ca "huỷ phiếu chưa trả gì")') }
            if (model === 'then') return undefined
            return new Proxy({}, {
                get: (_f, fn: string) => async (a?: any) => {
                    ghi(`${model}.${fn}`)
                    const f = mau[model]?.[fn]
                    return f ? f(a) : null
                },
            })
        },
    })
    return { prisma, goi }
}

async function traHang(body: any, phieu: any, khach: any = null, traTruoc: any[] = [], duong = '/:id/return') {
    const buoc = cacBuoc(transactionsRouter, 'put', duong)
    const { prisma, goi } = taoPrismaGia(phieu, khach, traTruoc)
    const req: any = {
        params: { id: phieu.id }, body, headers: {}, method: 'PUT', originalUrl: `/api/transactions/${phieu.id}${duong.slice(4)}`,
        storePrisma: prisma, user: { userId: 'u1', email: 'a@b.c', role: 'admin', storeSchema: 'store_thu' },
    }
    const res: any = { ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } }
    // bỏ authMiddleware (bước 0) — req.user đã gắn sẵn như sau khi xác thực
    for (const b of buoc.slice(1)) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
    return { ma: res.ma, than: res.than, goi }
}

const phieuMau = () => ({
    id: 't1', receiptNumber: 'HD-000123', status: 'completed', branchId: null, customerId: null, customerName: 'Khách lẻ',
    subtotal: 300000, total: 300000, discount: 0, discountType: 'fixed', tax: 0, amountReceived: 300000, createdAt: new Date(),
    items: [
        { id: 'i1', productId: 'p1', productName: 'Hàng A', sku: 'A1', quantity: 2, baseQuantity: 2, unitPrice: 100000, lineTotal: 200000, discount: 0, product: { costPrice: 50000 } },
        { id: 'i2', productId: 'p2', productName: 'Hàng B', sku: 'B1', quantity: 1, baseQuantity: 1, unitPrice: 100000, lineTotal: 100000, discount: 0, product: { costPrice: 60000 } },
    ],
    payments: [{ type: 'cash', amount: 300000 }],
})

async function main() {
    const buoc = cacBuoc(transactionsRouter, 'put', '/:id/return')
    dung('tìm được PUT /:id/return: authMiddleware + requirePermission + handler', buoc.length === 3, buoc.length)

    // 1. trả MỘT PHẦN: 1/2 cái Hàng A ⇒ phải 200, có mã RT-, tiền hoàn 100.000
    const a = await traHang({ reason: 'Hàng lỗi', returnItems: [{ productId: 'p1', quantity: 1 }] }, phieuMau())
    dung('trả một phần ⇒ 200 (không phải 500 sau khi đã ghi xong)', a.ma === 200 && a.than?.success === true, { ma: a.ma, than: a.than })
    dung('trả một phần ⇒ có mã phiếu trả RT-0007 + tiền hoàn 100.000', a.than?.data?.returnOrder?.code === 'RT-0007' && a.than?.data?.returnOrder?.totalRefund === 100000, a.than?.data?.returnOrder)
    dung('trả một phần ⇒ dòng hàng trả về đúng 1 dòng, SL 1', Array.isArray(a.than?.data?.returnOrder?.items) && a.than.data.returnOrder.items.length === 1 && a.than.data.returnOrder.items[0].quantity === 1, a.than?.data?.returnOrder?.items)
    dung('trả một phần ⇒ phiếu giữ trạng thái completed', a.than?.data?.status === 'completed', a.than?.data?.status)
    dung('trả một phần ⇒ đã cộng lại tồn (product.update) + ghi thẻ kho', a.goi.includes('product.update') && a.goi.includes('inventoryTransaction.create'), a.goi)

    // 2. trả TOÀN BỘ ⇒ 200 + 'returned'
    const b = await traHang({ reason: 'Khách đổi ý', returnItems: [] }, phieuMau())
    dung('trả toàn bộ ⇒ 200, trạng thái returned, hoàn 300.000', b.ma === 200 && b.than?.data?.status === 'returned' && b.than?.data?.returnOrder?.totalRefund === 300000, { ma: b.ma, than: b.than })

    // 3. chặn: SL vượt số đã bán ⇒ 400, KHÔNG ghi gì
    const c = await traHang({ reason: 'x', returnItems: [{ productId: 'p1', quantity: 3 }] }, phieuMau())
    dung('SL trả vượt số bán ⇒ 400, không ghi', c.ma === 400 && !c.goi.includes('transaction.update'), { ma: c.ma, goi: c.goi })

    // 4. phiếu đã huỷ ⇒ 400
    const d = await traHang({ reason: 'x' }, { ...phieuMau(), status: 'voided' })
    dung('phiếu đã huỷ ⇒ 400', d.ma === 400, d.ma)

    // 5. phiếu ghi nợ: trả một phần ⇒ trừ nợ khách tối đa phần còn nợ
    const no = { ...phieuMau(), status: 'partial', customerId: 'c1', customerName: 'Chị Lan', amountReceived: 100000 }
    const e = await traHang({ reason: 'Hàng lỗi', returnItems: [{ productId: 'p2', quantity: 1 }] }, no, { id: 'c1', name: 'Chị Lan', phone: '090', debt: 200000 })
    dung('phiếu ghi nợ trả một phần ⇒ 200 + ghi sổ nợ (DebtEntry)', e.ma === 200 && e.goi.includes('debtEntry.create'), { ma: e.ma, goi: e.goi })

    // ── CỘNG DỒN các lần trả (09/11/2026): bán 2 Hàng A, lần trước đã trả 1 ──
    const rt = (code: string, items: [string, number][]) => ({ code, items: items.map(([productId, quantity]) => ({ productId, quantity })) })
    const f = await traHang({ reason: 'x', returnItems: [{ productId: 'p1', quantity: 2 }] }, phieuMau(), null, [rt('RT-0005', [['p1', 1]])])
    dung('đã trả 1/2, xin trả 2 ⇒ 400 nêu số còn trả được, KHÔNG ghi', f.ma === 400 && /còn trả được \(1\)/.test(f.than?.error) && !f.goi.includes('transaction.update') && !f.goi.includes('product.update'), { ma: f.ma, than: f.than, goi: f.goi })
    const g = await traHang({ reason: 'x', returnItems: [{ productId: 'p1', quantity: 1 }] }, phieuMau(), null, [rt('RT-0005', [['p1', 1], ['p2', 1]])])
    dung('trả NỐT phần cuối (cộng các lần trước đủ) ⇒ 200, phiếu thành returned, hoàn 100.000', g.ma === 200 && g.than?.data?.status === 'returned' && g.than?.data?.returnOrder?.totalRefund === 100000, { ma: g.ma, data: g.than?.data && { status: g.than.data.status, ro: g.than.data.returnOrder } })
    const h = await traHang({ reason: 'x', returnItems: [] }, phieuMau(), null, [rt('RT-0005', [['p1', 1]])])
    dung('không gửi danh sách khi đã trả một phần ⇒ chỉ trả PHẦN CÒN LẠI (1 A + 1 B = 200.000)', h.ma === 200 && h.than?.data?.returnOrder?.totalRefund === 200000 && h.than?.data?.returnOrder?.items?.map((i: any) => `${i.productId}:${i.quantity}`).join(',') === 'p1:1,p2:1' && h.than?.data?.status === 'returned', { ma: h.ma, ro: h.than?.data?.returnOrder })
    const k = await traHang({ reason: 'x', returnItems: [] }, phieuMau(), null, [rt('RT-0005', [['p1', 2]]), rt('RT-0006', [['p2', 1]])])
    dung('đã trả hết ở các lần trước ⇒ 400 nêu các phiếu RT-, KHÔNG lập phiếu rỗng', k.ma === 400 && /RT-0005, RT-0006/.test(k.than?.error) && !k.goi.includes('returnOrder.create') && !k.goi.includes('transaction.update'), { ma: k.ma, than: k.than, goi: k.goi })
    const l = await traHang({ reason: 'x', returnItems: [{ productId: 'pX', quantity: 1 }] }, phieuMau())
    dung('mã không có trên phiếu ⇒ 400, không lập phiếu RT- 0đ', l.ma === 400 && !l.goi.includes('returnOrder.create'), { ma: l.ma, than: l.than })

    // ── DÒNG CÙNG MÃ (POS nhân dòng bán giá khác): Hàng A 2 cái @100.000 + 1 cái @80.000 ──
    const haiDong = () => {
        const p = phieuMau()
        p.items.push({ id: 'i3', productId: 'p1', productName: 'Hàng A', sku: 'A1', quantity: 1, baseQuantity: 1, unitPrice: 80000, lineTotal: 80000, discount: 0, product: { costPrice: 50000 } })
        p.subtotal = 380000; p.total = 380000; p.amountReceived = 380000
        return p
    }
    const m = await traHang({ reason: 'x', returnItems: [{ productId: 'p1', quantity: 1 }] }, haiDong())
    dung('2 dòng cùng mã, xin trả 1 ⇒ CHỈ 1 cái (dòng đầu), hoàn 100.000, cộng kho 1 lần', m.ma === 200 && m.than?.data?.returnOrder?.totalRefund === 100000 && m.than?.data?.returnOrder?.items?.length === 1 && m.goi.filter((x) => x === 'product.update').length === 1, { ma: m.ma, ro: m.than?.data?.returnOrder, goi: m.goi })
    const n = await traHang({ reason: 'x', returnItems: [{ productId: 'p1', quantity: 3 }] }, haiDong())
    dung('2 dòng cùng mã, xin trả 3 ⇒ chia 2 + 1, hoàn 280.000', n.ma === 200 && n.than?.data?.returnOrder?.totalRefund === 280000 && n.than?.data?.returnOrder?.items?.map((i: any) => i.quantity).join(',') === '2,1', { ma: n.ma, ro: n.than?.data?.returnOrder })
    const o = await traHang({ reason: 'x', returnItems: [{ productId: 'p1', quantity: 4 }] }, haiDong())
    dung('2 dòng cùng mã bán tổng 3, xin trả 4 ⇒ 400, không ghi', o.ma === 400 && !o.goi.includes('transaction.update'), { ma: o.ma, than: o.than })
    const q = await traHang({ reason: 'x', returnItems: [{ productId: 'p1', quantity: 1 }] }, haiDong(), null, [rt('RT-0005', [['p1', 2]])])
    dung('2 dòng cùng mã, lần trước trả 2 (hết dòng đầu) ⇒ lần này lấy dòng 80.000', q.ma === 200 && q.than?.data?.returnOrder?.totalRefund === 80000, { ma: q.ma, ro: q.than?.data?.returnOrder })

    // ── HUỶ PHIẾU đã có trả hàng ⇒ chặn (huỷ sẽ hoàn kho + trừ doanh số lần nữa phần đã trả) ──
    const buocHuy = cacBuoc(transactionsRouter, 'put', '/:id/void')
    dung('tìm được PUT /:id/void', buocHuy.length === 3, buocHuy.length)
    const v1 = await traHang({}, { ...phieuMau(), returnedAt: new Date() }, null, [], '/:id/void')
    dung('huỷ phiếu có returnedAt ⇒ 400, KHÔNG ghi', v1.ma === 400 && /đã có trả hàng/.test(v1.than?.error) && !v1.goi.includes('transaction.update'), { ma: v1.ma, than: v1.than, goi: v1.goi })
    const v2 = await traHang({}, phieuMau(), null, [rt('RT-0003', [['p1', 1]])], '/:id/void')
    dung('huỷ phiếu có phiếu RT- còn hiệu lực ⇒ 400 nêu mã RT-0003', v2.ma === 400 && /RT-0003/.test(v2.than?.error) && !v2.goi.includes('transaction.update'), { ma: v2.ma, than: v2.than })
    const v3 = await traHang({}, phieuMau(), null, [], '/:id/void')
    dung('huỷ phiếu CHƯA trả gì ⇒ qua chốt chặn (đi tiếp tới bước ghi)', v3.goi.includes('returnOrder.findFirst') && !(v3.ma === 400 && /đã có trả hàng/.test(v3.than?.error || '')) && v3.goi.includes('$transaction'), { ma: v3.ma, than: v3.than, goi: v3.goi.slice(0, 6) })

    console.log(`\n${tong - loi}/${tong} ca đạt${loi ? ` — ${loi} HỎNG` : ''}`)
    process.exit(loi ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
