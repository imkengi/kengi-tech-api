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

function taoPrismaGia(phieu: any, khach: any) {
    const goi: string[] = []
    const ghi = (s: string) => goi.push(s)
    const mau: Record<string, Record<string, (a?: any) => any>> = {
        transaction: {
            findUnique: () => phieu,
            update: (a: any) => ({ ...phieu, ...a.data, returnedAt: new Date(), items: phieu.items, payments: phieu.payments }),
        },
        user: { findUnique: () => ({ id: 'u1', name: 'Thu Ngân' }) },
        returnOrder: { create: (a: any) => ({ id: 'ro1', createdAt: new Date(), updatedAt: new Date(), ...voHuongQuanHe(a.data) }) },
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

async function traHang(body: any, phieu: any, khach: any = null) {
    const buoc = cacBuoc(transactionsRouter, 'put', '/:id/return')
    const { prisma, goi } = taoPrismaGia(phieu, khach)
    const req: any = {
        params: { id: phieu.id }, body, headers: {}, method: 'PUT', originalUrl: `/api/transactions/${phieu.id}/return`,
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

    console.log(`\n${tong - loi}/${tong} ca đạt${loi ? ` — ${loi} HỎNG` : ''}`)
    process.exit(loi ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
