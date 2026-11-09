/**
 * Bộ soát BÁN DỊCH VỤ khi cửa hàng TẮT "Cho phép bán âm kho" — POST /api/transactions (10/11/2026).
 *   npx tsx scripts/check-ban-dich-vu-ton.ts
 *
 * Sự cố: chốt chống bán vượt tồn (updateMany where stock >= baseQuantity, cả kho mặc định) áp cho MỌI dòng, kể cả
 * DỊCH VỤ (productType 'service' — không có tồn thật; danh sách tồn, báo cáo kho, POS web đều bỏ qua). Cửa hàng tắt
 * bán âm kho (mặc định của máy chủ) bán "Dịch vụ gói quà" tồn 0 ⇒ 409 "chỉ còn 0 trong kho" ⇒ không bán được dịch vụ
 * nào, trên POS web lẫn app máy tính (POS web không chặn dịch vụ lúc thêm vào giỏ, chỉ máy chủ chặn lúc lưu).
 *
 * Không DB: chạy requirePermission + validate + handler THẬT với storePrisma giả (bỏ authMiddleware, gắn sẵn req.user).
 * Prisma giả giữ tồn từng mã (Product.stock + WarehouseStock kho chính) và làm đúng `updateMany where gte`.
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

type Sp = { id: string; name: string; sku: string; productType: 'goods' | 'service'; stock: number; baseUnit: string }

function taoPrismaGia(dsSp: Sp[], choBanAm: boolean) {
    const goi: string[] = []
    const ton = new Map(dsSp.map((p) => [p.id, p.stock]))
    const tonKho = new Map(dsSp.map((p) => [p.id, p.stock])) // WarehouseStock kho chính (bất biến: = Product.stock)
    const sp = new Map(dsSp.map((p) => [p.id, p]))
    const moHinh = (ten: string, cacHam: Record<string, (a?: any) => any>) =>
        new Proxy({}, {
            get: (_f, fn: string) => async (a?: any) => {
                goi.push(`${ten}.${fn}${a?.where?.id ? `:${a.where.id}` : a?.where?.productId ? `:${a.where.productId}` : ''}`)
                const f = cacHam[fn]
                return f ? f(a) : null
            },
        })
    const chung: Record<string, Record<string, (a?: any) => any>> = {
        user: { findUnique: () => ({ id: 'u1', name: 'Thu Ngân' }), findFirst: () => null },
        transaction: { count: () => 0 },
        product: {
            findMany: (a: any) => (a?.where?.id?.in || []).map((id: string) => sp.get(id)).filter(Boolean).map((p: Sp) => ({ ...p, unitConversions: [] })),
        },
        storeSettings: { findFirst: () => ({ allowNegativeStock: choBanAm, autoCreateJournalEntries: false }) },
        branch: { findFirst: () => null, findUnique: () => null },
        warehouse: { findFirst: () => ({ id: 'w1', type: 'main', isDefault: true, branchId: null }), findUnique: () => null, create: () => ({ id: 'w1' }) },
        webhookEndpoint: { findMany: () => [] },
        customer: { findUnique: () => null },
    }
    const trongTx: Record<string, Record<string, (a?: any) => any>> = {
        transaction: { create: (a: any) => ({ id: 't1', ...a.data, items: a.data.items?.create || [], createdAt: new Date() }) },
        product: {
            update: (a: any) => {
                ton.set(a.where.id, (ton.get(a.where.id) ?? 0) - a.data.stock.decrement)
                return { ...sp.get(a.where.id), stock: ton.get(a.where.id), costPrice: 0 }
            },
            updateMany: (a: any) => {
                const id = a.where.id
                if ((ton.get(id) ?? 0) < a.where.stock.gte) return { count: 0 }
                ton.set(id, (ton.get(id) ?? 0) - a.data.stock.decrement)
                return { count: 1 }
            },
            findUnique: (a: any) => ({ stock: ton.get(a.where.id) ?? 0, costPrice: 0 }),
        },
        warehouseStock: {
            updateMany: (a: any) => {
                const id = a.where.productId
                if ((tonKho.get(id) ?? 0) < a.where.quantity.gte) return { count: 0 }
                tonKho.set(id, (tonKho.get(id) ?? 0) - a.data.quantity.decrement)
                return { count: 1 }
            },
            findUnique: (a: any) => ({ quantity: tonKho.get(a.where.warehouseId_productId.productId) ?? 0 }),
            upsert: (a: any) => {
                const id = a.where.warehouseId_productId.productId
                const d = a.update?.quantity?.increment ?? -(a.update?.quantity?.decrement ?? 0)
                tonKho.set(id, (tonKho.get(id) ?? 0) + d)
                return { quantity: tonKho.get(id) }
            },
        },
        inventoryTransaction: { create: () => ({}) },
    }
    const prisma: any = new Proxy({}, {
        get: (_m, model: string) => {
            if (model === 'then') return undefined
            if (model === '$executeRawUnsafe') return async () => 0
            if (model === '$queryRawUnsafe' || model === '$queryRaw') return async () => []
            if (model === '$transaction') return async (fn: any) => {
                goi.push('$transaction')
                const tx: any = new Proxy({}, { get: (_t, m: string) => (m === 'then' ? undefined : moHinh(m, trongTx[m] || {})) })
                return fn(tx)
            }
            return moHinh(model, chung[model] || {})
        },
    })
    return { prisma, goi, ton, tonKho }
}

const SP: Sp[] = [
    { id: 'p1', name: 'Bút bi Thiên Long', sku: 'TL027', productType: 'goods', stock: 0, baseUnit: 'Cây' },
    { id: 'p2', name: 'Vở Campus', sku: 'CP80', productType: 'goods', stock: 5, baseUnit: 'Quyển' },
    { id: 's1', name: 'Dịch vụ gói quà', sku: 'DV-GQ', productType: 'service', stock: 0, baseUnit: 'Lần' },
]

const dong = (p: Sp, sl: number, gia: number) => ({
    productId: p.id, productName: p.name, sku: p.sku, quantity: sl, unitPrice: gia, lineTotal: sl * gia, discount: 0, selectedUnit: p.baseUnit,
})

async function ban(lines: any[], choBanAm: boolean) {
    const buoc = cacBuoc(transactionsRouter, 'post', '/')
    const { prisma, goi, ton, tonKho } = taoPrismaGia(SP, choBanAm)
    const tongTien = lines.reduce((s, l) => s + l.lineTotal, 0)
    const req: any = {
        params: {}, headers: {}, method: 'POST', originalUrl: '/api/transactions',
        body: { items: lines, payments: [{ type: 'cash', amount: tongTien }], subtotal: tongTien, total: tongTien, amountReceived: tongTien, status: 'completed' },
        storePrisma: prisma, user: { userId: 'u1', email: 'a@b.c', role: 'admin', storeSchema: 'store_thu' },
    }
    const res: any = { ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } }
    for (const b of buoc.slice(1)) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
    return { ma: res.ma, than: res.than, goi, ton, tonKho }
}

async function main() {
    const buoc = cacBuoc(transactionsRouter, 'post', '/')
    dung('tìm được POST /: authMiddleware + requirePermission + validate + handler', buoc.length === 4, buoc.length)
    const [p1, p2, s1] = SP

    // 1. TẮT bán âm, chỉ bán dịch vụ (tồn 0) ⇒ bán được, trừ + ghi thẻ như cửa hàng cho bán âm
    const a = await ban([dong(s1, 1, 20000)], false)
    dung('tắt bán âm + bán DỊCH VỤ tồn 0 ⇒ 201 (trước đây 409 "chỉ còn 0 trong kho")', a.ma === 201, { ma: a.ma, than: a.than })
    dung('dịch vụ: trừ thẳng (product.update), KHÔNG qua chốt updateMany', a.goi.includes('product.update:s1') && !a.goi.includes('product.updateMany:s1'), a.goi)
    dung('dịch vụ: vẫn ghi thẻ kho như cũ', a.goi.includes('inventoryTransaction.create'), a.goi)

    // 2. TẮT bán âm, HÀNG HOÁ tồn 0 ⇒ vẫn chặn 409 như trước (không nới chốt cho hàng thật)
    const b = await ban([dong(p1, 1, 5000)], false)
    dung('tắt bán âm + HÀNG HOÁ tồn 0 ⇒ 409 "chỉ còn 0 trong kho (cần 1)"', b.ma === 409 && /chỉ còn 0 trong kho \(cần 1\)/.test(b.than?.error || ''), { ma: b.ma, than: b.than })
    dung('hàng hoá hết: KHÔNG trừ tồn', b.ton.get('p1') === 0 && !b.goi.includes('product.update:p1'), { ton: b.ton.get('p1'), goi: b.goi })

    // 3. TẮT bán âm, hàng còn đủ + dịch vụ cùng phiếu ⇒ bán được; hàng qua chốt, kho chính đi cùng
    const c = await ban([dong(p2, 3, 12000), dong(s1, 1, 20000)], false)
    dung('tắt bán âm + hàng đủ (5 ≥ 3) + dịch vụ ⇒ 201', c.ma === 201, { ma: c.ma, than: c.than })
    dung('hàng hoá đi qua chốt updateMany, còn 2; kho chính cũng 2', c.goi.includes('product.updateMany:p2') && c.ton.get('p2') === 2 && c.tonKho.get('p2') === 2, { ton: c.ton.get('p2'), kho: c.tonKho.get('p2') })

    // 4. TẮT bán âm, hàng THIẾU + dịch vụ cùng phiếu ⇒ cả phiếu bị chặn vì dòng hàng (dịch vụ không cứu được dòng thiếu)
    const d = await ban([dong(s1, 1, 20000), dong(p2, 6, 12000)], false)
    dung('tắt bán âm + hàng thiếu (5 < 6) dù có dịch vụ ⇒ 409 nêu đúng mặt hàng thiếu', d.ma === 409 && /Vở Campus.*chỉ còn 5 trong kho \(cần 6\)/.test(d.than?.error || ''), { ma: d.ma, than: d.than })

    // 5. BẬT bán âm: hàng tồn 0 vẫn bán được (hành vi cũ giữ nguyên)
    const e = await ban([dong(p1, 2, 5000), dong(s1, 1, 20000)], true)
    dung('bật bán âm + hàng tồn 0 + dịch vụ ⇒ 201, hàng xuống −2', e.ma === 201 && e.ton.get('p1') === -2, { ma: e.ma, ton: e.ton.get('p1'), than: e.than })

    console.log(`\n${tong - loi}/${tong} ca đạt${loi ? ` — ${loi} HỎNG` : ''}`)
    process.exit(loi ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
