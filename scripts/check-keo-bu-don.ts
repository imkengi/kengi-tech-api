/**
 * check-keo-bu-don — đơn KÉO BÙ (lib/dauKeoBu.ts) lập phiếu doanh thu mà KHÔNG trừ kho / thẻ kho / kho mẹ / bút toán; đơn thường
 * vẫn trừ kho + ghi sổ như cũ. Chạy hàm lập phiếu THẬT (services/orderSync) trên prisma giả ghi lại mọi lời gọi. 11/11/2026.
 * Kèm: bộ kéo bù (lib/keoBuDonSan) chạy thử không ghi gì, ghi thật chỉ nhập đơn sàn COMPLETED mà Kengi chưa có.
 *
 * Chạy: npm run check:keo-bu-don
 */
import { convertOnlineOrderToTransaction } from '../src/services/orderSync'
import { keoBuDonShopee } from '../src/lib/keoBuDonSan'
import { GHI_CHU_KEO_BU, laDonKeoBu } from '../src/lib/dauKeoBu'

let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }

const SP = { id: 'p1', name: 'Máy xay thử', sku: 'MX1', stock: 10, costPrice: 50_000, sellingPrice: 100_000, bundleId: null, mergedIntoId: null }

function taoPrisma(donDau: any[] = []) {
    const goi: { m: string; a: any }[] = []
    const don = new Map<string, any>(donDau.map(d => [d.id, d]))
    const phieu: any[] = []
    let soId = 0
    const rieng: Record<string, (a: any) => any> = {
        'onlineOrder.findUnique': a => don.get(a.where.id) || null,
        'onlineOrder.findMany': a => [...don.values()].filter(d => !a?.where?.orderNumber?.in || a.where.orderNumber.in.includes(d.orderNumber)).map(d => ({ orderNumber: d.orderNumber, id: d.id })),
        'onlineOrder.create': a => { const d = { id: 'o' + (++soId), khongKhopSku: false, ...a.data, items: (a.data.items?.create || []).map((x: any, i: number) => ({ id: 'i' + soId + '_' + i, productId: null, ...x })) }; don.set(d.id, d); return { id: d.id } },
        'onlineOrder.updateMany': a => { const d = don.get(a.where.id); if (!d) return { count: 0 }; if (a.where.stockDeducted === false && d.stockDeducted) return { count: 0 }; Object.assign(d, a.data); return { count: 1 } },
        'onlineOrder.update': a => { const d = don.get(a.where.id); if (d) Object.assign(d, a.data); return d || {} },
        'transaction.findFirst': a => phieu.find(p => p.receiptNumber === a.where.receiptNumber) || null,
        'transaction.findMany': a => phieu.filter(p => !a?.where?.receiptNumber?.in || a.where.receiptNumber.in.includes(p.receiptNumber)).map(p => ({ receiptNumber: p.receiptNumber, status: p.status })),
        'transaction.create': a => { const p = { id: 't' + (++soId), ...a.data, items: (a.data.items?.create || []).map((x: any) => ({ ...x, product: { costPrice: SP.costPrice } })), payments: a.data.payments?.create || [] }; phieu.push(p); return p },
        'user.findFirst': () => ({ id: 'u1' }),
        'product.findUnique': a => (a.where.id === SP.id ? { ...SP } : null),
        'product.findMany': a => (a?.select?.sku && !a.where ? [{ sku: SP.sku }] : [{ ...SP }]),
        'product.findFirst': () => ({ ...SP }),
        'skuMapping.findMany': () => [{ platformSku: 'MAP-1' }],
    }
    const model = (ten: string) => new Proxy({}, {
        get: (_t, p: string) => async (a: any) => {
            const m = `${ten}.${p}`
            goi.push({ m, a })
            if (rieng[m]) return rieng[m](a)
            if (/^find(Many)?$|^findMany$/.test(p) || p === 'findMany') return []
            if (p === 'findFirst' || p === 'findUnique') return null
            if (p === 'updateMany' || p === 'deleteMany' || p === 'createMany') return { count: 0 }
            if (p === 'count') return 0
            if (p === 'aggregate') return { _sum: {}, _count: 0 }
            return {}
        },
    })
    const sp: any = new Proxy({ __schema: 'thu' }, {
        get: (t: any, p: string) => {
            if (p in t) return t[p]
            if (p === '$transaction') return async (f: any) => (typeof f === 'function' ? f(sp) : Promise.all(f))
            if (p === '$queryRawUnsafe' || p === '$queryRaw') return async (...a: any[]) => { goi.push({ m: p, a }); return [] }
            if (p === '$executeRawUnsafe' || p === '$executeRaw') return async (...a: any[]) => { goi.push({ m: p, a }); return 0 }
            if (p === 'then') return undefined
            return model(p)
        },
    })
    return { sp, goi, don, phieu }
}

const donMau = (id: string, them: any = {}) => ({
    id, orderNumber: 'SPE-' + id.toUpperCase(), platform: 'shopee', status: 'completed', externalOrderId: id.toUpperCase(),
    customerName: 'Khách', customerPhone: null, subtotal: 200_000, discount: 0, total: 200_000, paymentMethod: 'Shopee',
    createdAt: new Date('2026-01-15T03:00:00Z'), stockDeducted: false, khongKhopSku: false, note: null,
    items: [{ id: 'i-' + id, productId: 'p1', productName: 'Máy xay thử', sku: 'MX1', quantity: 2, unitPrice: 100_000, discount: 0, lineTotal: 200_000 }],
    ...them,
})
/** Lời gọi GHI vào kho / thẻ kho / sổ */
const ghiKho = (goi: { m: string }[]) => goi.filter(g => /^(inventoryTransaction\.(create|createMany)|warehouseStock\.(update|upsert|create|updateMany)|product\.(update|updateMany)|stockMovement\.)/.test(g.m)).map(g => g.m)
const ghiSo = (goi: { m: string }[]) => goi.filter(g => /^(journalEntry|journalLine|journalEntryLine)\.(create|createMany)/.test(g.m)).map(g => g.m)

async function main() {
    console.log('▶ check-keo-bu-don')
    ca('A1 nhận dấu kéo bù', laDonKeoBu(GHI_CHU_KEO_BU) && !laDonKeoBu(null) && !laDonKeoBu('khách dặn giao giờ hành chính'))

    // ── B. đơn THƯỜNG: vẫn trừ kho như cũ (đối chứng — bộ giả bắt được việc ghi kho) ──
    {
        const { sp, goi, don, phieu } = taoPrisma([donMau('thuong1')])
        const ok = await convertOnlineOrderToTransaction(sp, 'thuong1')
        ca('B1 đơn thường lên phiếu', ok && phieu.length === 1 && phieu[0].total === 200_000)
        ca('B2 đơn thường CÓ ghi thẻ kho + giành cờ đã trừ kho', goi.some(g => g.m === 'inventoryTransaction.create') && don.get('thuong1').stockDeducted === true, ghiKho(goi).join(','))
        ca('B3 phiếu đơn thường không mang dấu kéo bù', !laDonKeoBu(phieu[0].notes))
    }
    // ── C. đơn KÉO BÙ ──
    {
        const { sp, goi, don, phieu } = taoPrisma([donMau('bu1', { note: GHI_CHU_KEO_BU, stockDeducted: true })])
        const ok = await convertOnlineOrderToTransaction(sp, 'bu1')
        const p = phieu[0]
        ca('C1 đơn kéo bù lên phiếu doanh thu đủ tiền, đúng ngày đặt', ok && p?.total === 200_000 && p?.status === 'completed' && p?.channel === 'online' && p?.receiptNumber === 'ONLINE-SPE-BU1' && +new Date(p.transactionDate) === +new Date('2026-01-15T03:00:00Z'))
        ca('C2 phiếu có dòng hàng nối hàng kho (để báo cáo theo mặt hàng)', p?.items?.length === 1 && p.items[0].productId === 'p1' && p.items[0].baseQuantity === 2)
        ca('C3 KHÔNG ghi gì vào kho / thẻ kho', ghiKho(goi).length === 0, ghiKho(goi).join(','))
        ca('C4 KHÔNG ghi bút toán', ghiSo(goi).length === 0 && !goi.some(g => g.m.startsWith('journalEntry.')), goi.filter(g => g.m.startsWith('journal')).map(g => g.m).join(','))
        ca('C5 phiếu ghi rõ là kéo bù, không trừ kho', laDonKeoBu(p?.notes) && /không trừ kho/.test(p.notes))
        ca('C6 cờ đã-trừ-kho của đơn giữ nguyên true', don.get('bu1').stockDeducted === true)
    }
    {
        // dấu kéo bù mà cờ stockDeducted lỡ là false (ai đó sửa tay) ⇒ VẪN không trừ kho
        const { sp, goi } = taoPrisma([donMau('bu2', { note: GHI_CHU_KEO_BU, stockDeducted: false })])
        await convertOnlineOrderToTransaction(sp, 'bu2')
        ca('C7 dấu kéo bù tự nó đủ chặn trừ kho (không dựa vào cờ)', ghiKho(goi).length === 0 && !goi.some(g => g.m === 'onlineOrder.updateMany' && g.a?.data?.stockDeducted === true), ghiKho(goi).join(','))
    }
    {
        const { sp } = taoPrisma([donMau('bu3', { note: GHI_CHU_KEO_BU, stockDeducted: true })])
        await convertOnlineOrderToTransaction(sp, 'bu3')
        ca('C8 chạy lại không đẻ phiếu trùng', (await convertOnlineOrderToTransaction(sp, 'bu3')) === false)
    }

    // ── D. bộ kéo bù ──
    const chiTiet = (sn: string, st = 'COMPLETED', sku = 'MX1') => ({
        externalOrderId: sn, orderNumber: 'SPE-' + sn, platform: 'shopee', status: 'completed', externalStatus: st, customerName: 'K', customerPhone: '',
        shippingAddress: '', subtotal: 150_000, discount: 0, shippingFee: 0, total: 150_000, paymentMethod: 'Shopee', paymentStatus: 'paid',
        items: [{ productName: 'Máy xay thử', sku, quantity: 1, unitPrice: 150_000, discount: 0, lineTotal: 150_000 }], createdAt: '2026-01-10T05:00:00.000Z',
    })
    const taoSvc = () => {
        const hoi: string[][] = []
        return {
            hoi,
            lietKeMaDonTheoNgayDat: async () => ({ don: [{ sn: 'A1', status: 'COMPLETED' }, { sn: 'A2', status: 'COMPLETED' }, { sn: 'A3', status: 'CANCELLED' }, { sn: 'A4', status: 'COMPLETED' }, { sn: 'A5', status: 'COMPLETED' }], chamTran: false, dungO: null }),
            // A4 lúc đọc chi tiết đã chuyển TO_RETURN; A5 mang SKU lạ
            layChiTietNhieuDon: async (sns: string[]) => { hoi.push(sns); return sns.map(s => chiTiet(s, s === 'A4' ? 'TO_RETURN' : 'COMPLETED', s === 'A5' ? 'SKU-LA' : 'MX1')) },
        }
    }
    const O = { tu: new Date('2026-01-01'), den: new Date('2026-02-01'), hanMs: 60_000, gioiHan: 5000 }
    {
        // A1 đã có phiếu trong Kengi
        const { sp, goi, phieu, don } = taoPrisma()
        phieu.push({ id: 'cu', receiptNumber: 'ONLINE-SPE-A1', status: 'completed', total: 1 })
        const svc = taoSvc()
        const kq = await keoBuDonShopee(sp, { id: 'k1', name: 'Gian' }, svc, { ...O, apply: false })
        ca('D1 chạy thử: đếm đúng (sàn 4 hoàn thành, Kengi có 1, thiếu 3; đơn đổi trạng thái bị bỏ)', kq.trenSanHoanThanh === 4 && kq.daCoTrongKengi === 1 && kq.thieu === 3 && kq.daXet === 2 && kq.boQuaKhongConHoanThanh === 1 && kq.tongTien === 300_000, JSON.stringify(kq))
        ca('D2 chạy thử: KHÔNG ghi gì', !goi.some(g => /\.(create|update|updateMany|delete|deleteMany|upsert|createMany)$/.test(g.m)) && phieu.length === 1 && don.size === 0, goi.filter(g => /\.(create|update)/.test(g.m)).map(g => g.m).join(','))
        ca('D3 chạy thử: báo SKU lạ + gom theo tháng VN', kq.uocKhongKhopSku === 1 && kq.skuLa[0] === 'SKU-LA ×1' && kq.theoThang['2026-01']?.don === 2)
        ca('D4 không hỏi chi tiết đơn huỷ / đơn Kengi đã có', !svc.hoi.flat().includes('A3') && !svc.hoi.flat().includes('A1'))

        const svc2 = taoSvc()
        const kq2 = await keoBuDonShopee(sp, { id: 'k1', name: 'Gian' }, svc2, { ...O, apply: true })
        const moi = [...don.values()]
        ca('D5 ghi thật: nhập 2 đơn mang dấu kéo bù + cờ đã trừ kho', kq2.daNhap === 2 && moi.length === 2 && moi.every(d => laDonKeoBu(d.note) && d.stockDeducted === true && d.channelId === 'k1'), JSON.stringify(kq2))
        ca('D6 ghi thật: lên phiếu ngay, không đụng kho / sổ', kq2.lenPhieu === 2 && phieu.length === 3 && ghiKho(goi).length === 0 && ghiSo(goi).length === 0, ghiKho(goi).concat(ghiSo(goi)).join(','))
        ca('D7 phiếu cũ của Kengi không bị đụng', phieu[0].total === 1 && !goi.some(g => g.m === 'transaction.update' || g.m === 'transaction.updateMany'))
        const kq3 = await keoBuDonShopee(sp, { id: 'k1', name: 'Gian' }, taoSvc(), { ...O, apply: true })
        ca('D8 chạy lại: không nhập trùng', kq3.daNhap === 0 && kq3.thieu === 1 && don.size === 2, JSON.stringify({ n: kq3.daNhap, t: kq3.thieu }))
    }
    {
        const { sp } = taoPrisma()
        const kq = await keoBuDonShopee(sp, { id: 'k1', name: 'Gian' }, { lietKeMaDonTheoNgayDat: async () => ({ don: [{ sn: 'X', status: 'COMPLETED' }], chamTran: true }), layChiTietNhieuDon: async () => [] }, { ...O, apply: true })
        ca('D9 liệt kê chưa hết ⇒ dừng, không nhập phần dở', kq.chamTran && kq.daNhap === 0 && kq.loi.length === 1)
    }
    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
