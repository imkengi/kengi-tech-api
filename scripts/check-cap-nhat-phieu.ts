/**
 * Bộ soát CẬP NHẬT PHIẾU — POST /api/transactions có revisionOfId + POST /api/transactions/:id/revise (10/11/2026).
 *   npx tsx scripts/check-cap-nhat-phieu.ts
 *
 * "Cập nhật" phiếu trên web = HUỶ phiếu gốc + bán phiếu mới "<gốc>.N". Từ 13/08/2026 việc huỷ phiếu gốc nằm trong POST
 * (hoàn kho, trả doanh số khách) nhưng thiếu ba thứ mà nút Huỷ (PUT /:id/void) có:
 *   - KHÔNG đảo bút toán phiếu gốc ⇒ sổ ghi doanh thu HAI LẦN (đo prod 10/11: HUTI 1 phiếu 2.446.380đ, KENGIONLINE 5 phiếu);
 *   - KHÔNG xoá nợ còn treo của phiếu gốc ghi nợ ⇒ phiếu mới ghi nợ lại ⇒ khách nợ hai lần;
 *   - KHÔNG chặn phiếu đã trả hàng ⇒ hoàn kho toàn bộ lần nữa phần đã trả.
 * Thêm: bấm hai lần ⇒ lần hai lập phiếu .2 như đơn bán MỚI (không hoàn kho) ⇒ bán trùng; /:id/revise (web gọi sau khi
 * bán) gặp phiếu gốc 'voided' là 400 ⇒ không nối revisionOfId, bảo hành ở lại phiếu đã huỷ; không chặn chéo chi nhánh.
 *
 * Không DB: chạy requirePermission + validate + handler THẬT với storePrisma giả (bỏ authMiddleware, gắn sẵn req.user).
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

type Ghi = { ten: string; a: any }

/** `goc` = phiếu gốc (findUnique trả về); `huyDuoc` = updateMany giành quyền huỷ có được không (false = máy khác vừa huỷ). */
function taoPrismaGia(goc: any, o: { huyDuoc?: boolean; traTruoc?: any; khach?: any; butToanGoc?: any[] } = {}) {
    const ghi: Ghi[] = []
    const SP = { id: 'p1', name: 'Hàng A', sku: 'A1', productType: 'goods', stock: 10, baseUnit: 'Cái', costPrice: 50000, unitConversions: [] }
    const ham: Record<string, Record<string, (a?: any) => any>> = {
        user: { findUnique: () => ({ id: 'u1', name: 'Thu Ngân', permissions: '[]' }), findFirst: () => null },
        transaction: {
            findUnique: () => goc,
            count: () => 0,
            create: (a: any) => ({ id: 't-moi', ...a.data, items: (a.data.items?.create || []).map((i: any) => ({ ...i, product: { costPrice: 50000 } })), payments: a.data.payments?.create || [], createdAt: new Date() }),
            updateMany: () => ({ count: o.huyDuoc === false ? 0 : 1 }),
            update: (a: any) => ({ ...goc, ...a.data }),
        },
        product: {
            findMany: () => [SP],
            update: () => ({ ...SP, stock: 9 }),
            updateMany: () => ({ count: 1 }),
            findUnique: () => ({ stock: 10, costPrice: 50000 }),
        },
        storeSettings: { findFirst: () => ({ allowNegativeStock: true, autoCreateJournalEntries: false }) },
        branch: { findFirst: () => null, findUnique: () => null },
        warehouse: { findFirst: () => ({ id: 'w1', type: 'main', isDefault: true, branchId: null }), findUnique: () => null, create: () => ({ id: 'w1' }) },
        warehouseStock: { upsert: () => ({}), findUnique: () => null, update: () => ({}), updateMany: () => ({ count: 1 }) },
        inventoryTransaction: { create: () => ({}) },
        returnOrder: { findFirst: () => o.traTruoc || null, findMany: () => [], updateMany: () => ({ count: 0 }) },
        customer: {
            findUnique: () => o.khach || null,
            update: (a: any) => ({ ...(o.khach || {}), ...a.data, debt: o.khach?.debt ?? 0 }),
            updateMany: () => ({ count: 1 }),
        },
        debtEntry: { create: () => ({}) },
        journalEntry: { findMany: () => o.butToanGoc || [], create: () => ({}) },
        warranty: { updateMany: () => ({ count: 2 }) },
        auditLog: { create: () => ({}) },
        webhookEndpoint: { findMany: () => [] },
    }
    const moHinh = (ten: string) => new Proxy({}, {
        get: (_f, fn: string) => async (a?: any) => {
            ghi.push({ ten: `${ten}.${fn}`, a })
            const f = ham[ten]?.[fn]
            return f ? f(a) : null
        },
    })
    const prisma: any = new Proxy({}, {
        get: (_m, model: string) => {
            if (model === 'then') return undefined
            if (model === '$executeRawUnsafe') return async () => 0
            if (model === '$queryRawUnsafe' || model === '$queryRaw') return async () => []
            if (model === '$transaction') return async (fn: any) => {
                ghi.push({ ten: '$transaction', a: null })
                return fn(new Proxy({}, { get: (_t, m: string) => (m === 'then' ? undefined : moHinh(m)) }))
            }
            return moHinh(model)
        },
    })
    return { prisma, ghi }
}

async function goi(method: 'post', duong: string, body: any, goc: any, o: Parameters<typeof taoPrismaGia>[1] = {}, user: any = {}) {
    const buoc = cacBuoc(transactionsRouter, method, duong)
    const { prisma, ghi } = taoPrismaGia(goc, o)
    const req: any = {
        params: { id: goc?.id }, headers: {}, method: 'POST', originalUrl: '/api/transactions', body,
        storePrisma: prisma, user: { userId: 'u1', email: 'a@b.c', role: 'admin', storeSchema: 'store_thu', ...user },
    }
    const res: any = { ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } }
    for (const b of buoc.slice(1)) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
    // đảo bút toán chạy post-commit có await trong handler; webhook/emit chạy nền — chờ một nhịp cho chắc
    await new Promise((r) => setTimeout(r, 20))
    const co = (ten: string, loc?: (a: any) => boolean) => ghi.some((g) => g.ten === ten && (!loc || loc(g.a)))
    return { ma: res.ma, than: res.than, ghi, co, ten: ghi.map((g) => g.ten) }
}

const phieuGoc = (them: any = {}) => ({
    id: 'g1', receiptNumber: 'HD-0001', status: 'completed', branchId: null, customerId: null, customerName: null, notes: null,
    subtotal: 200000, total: 200000, discount: 0, tax: 0, amountReceived: 200000, returnedAt: null, createdAt: new Date(),
    items: [{ id: 'i1', productId: 'p1', productName: 'Hàng A', sku: 'A1', quantity: 2, baseQuantity: 2, unitPrice: 100000, lineTotal: 200000, discount: 0 }],
    ...them,
})
const banSua = (them: any = {}) => ({
    revisionOfId: 'g1',
    items: [{ productId: 'p1', productName: 'Hàng A', sku: 'A1', quantity: 1, unitPrice: 100000, lineTotal: 100000, discount: 0 }],
    payments: [{ type: 'cash', amount: 100000 }], subtotal: 100000, total: 100000, amountReceived: 100000, status: 'completed',
    ...them,
})
const BUT_TOAN_GOC = [
    { id: 'j1', reference: 'SALE-HD-0001', description: 'Doanh thu HD-0001', debitAccount: '111', creditAccount: '511', amount: 200000 },
    { id: 'j2', reference: 'COGS-HD-0001', description: 'Giá vốn HD-0001', debitAccount: '632', creditAccount: '156', amount: 100000 },
]

async function main() {
    dung('tìm được POST / và POST /:id/revise', cacBuoc(transactionsRouter, 'post', '/').length === 4 && cacBuoc(transactionsRouter, 'post', '/:id/revise').length === 3)

    // 1. phiếu gốc thường ⇒ 201, nối revisionOfId, ĐẢO bút toán phiếu gốc
    const a = await goi('post', '/', banSua(), phieuGoc(), { butToanGoc: BUT_TOAN_GOC })
    dung('cập nhật phiếu thường ⇒ 201, số mới HD-0001.1', a.ma === 201 && a.than?.data?.receiptNumber === 'HD-0001.1', { ma: a.ma, than: a.than })
    dung('phiếu mới mang revisionOfId = phiếu gốc ngay khi tạo', a.co('transaction.create', (x) => x?.data?.revisionOfId === 'g1'), a.ghi.find((g) => g.ten === 'transaction.create')?.a?.data?.revisionOfId)
    const dao = a.ghi.filter((g) => g.ten === 'journalEntry.create').map((g) => g.a?.data?.reference)
    dung('đảo ĐỦ bút toán phiếu gốc: VOID-SALE-HD-0001 + VOID-COGS-HD-0001', dao.includes('VOID-SALE-HD-0001') && dao.includes('VOID-COGS-HD-0001'), dao)
    dung('tìm bút toán cần đảo đúng theo số phiếu GỐC (không chạm phiếu mới .1)', a.co('journalEntry.findMany', (x) => JSON.stringify(x?.where).includes('SALE-HD-0001') && !JSON.stringify(x?.where).includes('HD-0001.1')), a.ghi.find((g) => g.ten === 'journalEntry.findMany')?.a)
    dung('đơn bán thường (không sửa) KHÔNG gửi cột revisionOfId', !(await goi('post', '/', { ...banSua(), revisionOfId: undefined }, phieuGoc())).co('transaction.create', (x) => 'revisionOfId' in (x?.data || {})))

    // 2. phiếu gốc GHI NỢ còn treo 150.000 ⇒ xoá nợ như nút Huỷ (khách đang nợ 400.000)
    const no = phieuGoc({ status: 'partial', customerId: 'c1', customerName: 'Chị Lan', amountReceived: 50000 })
    const b = await goi('post', '/', banSua({ customerId: 'c1', customerName: 'Chị Lan' }), no, { khach: { id: 'c1', name: 'Chị Lan', phone: '090', debt: 400000 } })
    dung('cập nhật phiếu ghi nợ ⇒ 201', b.ma === 201, { ma: b.ma, than: b.than })
    dung('xoá nợ treo phiếu gốc: customer.update debt −150.000', b.co('customer.update', (x) => x?.data?.debt?.decrement === 150000), b.ghi.filter((g) => g.ten === 'customer.update').map((g) => g.a?.data))
    dung('ghi sổ nợ "Hủy đơn HD-0001 - xóa nợ" 150.000, số dư 250.000', b.co('debtEntry.create', (x) => x?.data?.description === 'Hủy đơn HD-0001 - xóa nợ' && x?.data?.amount === 150000 && x?.data?.type === 'return' && x?.data?.balance === 250000), b.ghi.filter((g) => g.ten === 'debtEntry.create').map((g) => g.a?.data))
    const nk = b.ten.indexOf('debtEntry.create'), tk = b.ten.lastIndexOf('product.update')
    dung('xoá nợ nằm TRONG giao dịch, trước khi trừ kho phiếu mới', b.ten.indexOf('$transaction') < nk && nk < tk, b.ten)
    const c = await goi('post', '/', banSua(), phieuGoc({ status: 'partial', customerId: 'c1', amountReceived: 50000 }), { khach: { id: 'c1', name: 'Chị Lan', debt: 60000 } })
    dung('nợ khách (60.000) < nợ phiếu ⇒ chỉ xoá 60.000, không âm', c.co('customer.update', (x) => x?.data?.debt?.decrement === 60000), c.ghi.filter((g) => g.ten === 'customer.update').map((g) => g.a?.data))
    const d = await goi('post', '/', banSua(), phieuGoc({ customerId: 'c1' }), { khach: { id: 'c1', name: 'Chị Lan', debt: 400000 } })
    dung('phiếu gốc đã trả đủ (completed) ⇒ KHÔNG đụng nợ', d.ma === 201 && !d.co('debtEntry.create') && !d.co('customer.update', (x) => x?.data?.debt), d.ten)

    // 3. chặn TRƯỚC khi ghi: phiếu đã trả hàng / phiếu RT- / 'returned' / đã huỷ / chéo chi nhánh
    const e = await goi('post', '/', banSua(), phieuGoc({ returnedAt: new Date() }))
    dung('phiếu gốc đã trả hàng một phần ⇒ 400, không mở giao dịch', e.ma === 400 && /đã có trả hàng/.test(e.than?.error || '') && !e.co('$transaction'), { ma: e.ma, than: e.than })
    const f = await goi('post', '/', banSua(), phieuGoc(), { traTruoc: { code: 'RT-0003' } })
    dung('phiếu gốc có phiếu RT-0003 còn hiệu lực ⇒ 400 nêu RT-0003', f.ma === 400 && /RT-0003/.test(f.than?.error || '') && !f.co('$transaction'), { ma: f.ma, than: f.than })
    const g = await goi('post', '/', banSua(), phieuGoc({ status: 'returned' }))
    dung("phiếu gốc 'returned' ⇒ 400", g.ma === 400 && !g.co('$transaction'), { ma: g.ma, than: g.than })
    const h = await goi('post', '/', banSua(), phieuGoc({ status: 'voided', notes: '[Cập nhật] → HD-0001.1' }))
    dung('phiếu gốc ĐÃ huỷ (bấm lần hai / máy khác) ⇒ 409, KHÔNG lập phiếu .2', h.ma === 409 && !h.co('$transaction') && !h.co('transaction.create'), { ma: h.ma, than: h.than })
    const k = await goi('post', '/', banSua(), phieuGoc(), { huyDuoc: false })
    dung('đua: lúc đọc còn hiệu lực nhưng máy khác huỷ trước (updateMany 0) ⇒ 409, không trừ kho', k.ma === 409 && !k.co('inventoryTransaction.create'), { ma: k.ma, than: k.than })
    const l = await goi('post', '/', banSua(), phieuGoc({ branchId: 'b2' }), {}, { role: 'cashier', branchId: 'b1', isMainBranch: false })
    dung('thu ngân chi nhánh b1 cập nhật phiếu của b2 ⇒ 404, không ghi', l.ma === 404 && !l.co('$transaction'), { ma: l.ma, than: l.than })

    // 4. /:id/revise SAU khi POST đã huỷ phiếu gốc (POS web vẫn gọi) ⇒ 200, chỉ NỐI: không hoàn kho/trả doanh số lần nữa
    const daHuy = phieuGoc({ status: 'voided', notes: '[Cập nhật] → HD-0001.1', customerId: 'c1' })
    const m = await goi('post', '/:id/revise', { newTransactionId: 't-moi', newReceiptNumber: 'HD-0001.1' }, daHuy, { khach: { id: 'c1', debt: 0 } })
    dung('/revise sau POST ⇒ 200 (trước đây 400 "already voided")', m.ma === 200 && m.than?.success === true, { ma: m.ma, than: m.than })
    dung('/revise sau POST ⇒ KHÔNG hoàn kho lần hai, KHÔNG trừ doanh số khách lần hai', !m.co('product.update') && !m.co('inventoryTransaction.create') && !m.co('customer.update'), m.ten)
    dung('/revise sau POST ⇒ chuyển bảo hành sang phiếu mới + nối revisionOfId', m.co('warranty.updateMany', (x) => x?.data?.transactionId === 't-moi') && m.co('transaction.update', (x) => x?.where?.id === 't-moi' && x?.data?.revisionOfId === 'g1'), m.ten)
    const n = await goi('post', '/:id/revise', { newTransactionId: 't-moi', newReceiptNumber: 'HD-0001.1' }, phieuGoc({ status: 'voided', notes: null }))
    dung('/revise trên phiếu bị HUỶ TAY (không có dấu cập nhật) ⇒ vẫn 400', n.ma === 400, { ma: n.ma, than: n.than })
    const p = await goi('post', '/:id/revise', { newTransactionId: 't-moi', newReceiptNumber: 'HD-0001.2' }, phieuGoc({ status: 'voided', notes: '[Cập nhật] → HD-0001.1' }))
    dung('/revise ghi số mới KHÁC số trong dấu cập nhật ⇒ 400 (không nối nhầm)', p.ma === 400, { ma: p.ma, than: p.than })

    // 5. đường cũ: /revise trên phiếu CHƯA huỷ (POST không đọc được phiếu gốc) ⇒ huỷ + hoàn kho + xoá nợ + đảo bút toán
    const q = await goi('post', '/:id/revise', { newTransactionId: 't-moi', newReceiptNumber: 'HD-0001.1' }, no, { khach: { id: 'c1', name: 'Chị Lan', debt: 400000 }, butToanGoc: BUT_TOAN_GOC })
    dung('/revise đường cũ ⇒ 200, huỷ phiếu gốc + hoàn kho', q.ma === 200 && q.co('transaction.update', (x) => x?.data?.status === 'voided') && q.co('product.update'), { ma: q.ma, ten: q.ten })
    dung('/revise đường cũ ⇒ xoá nợ treo 150.000 + đảo bút toán phiếu gốc', q.co('debtEntry.create', (x) => x?.data?.amount === 150000) && q.ghi.filter((g2) => g2.ten === 'journalEntry.create').map((g2) => g2.a?.data?.reference).includes('VOID-SALE-HD-0001'), q.ten)
    const r = await goi('post', '/:id/revise', { newTransactionId: 't-moi', newReceiptNumber: 'HD-0001.1' }, phieuGoc({ returnedAt: new Date() }))
    dung('/revise đường cũ trên phiếu đã trả hàng ⇒ 400, không huỷ', r.ma === 400 && !r.co('transaction.update'), { ma: r.ma, than: r.than })

    console.log(`\n${tong - loi}/${tong} ca đạt${loi ? ` — ${loi} HỎNG` : ''}`)
    process.exit(loi ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
