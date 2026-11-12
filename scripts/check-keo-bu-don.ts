/**
 * check-keo-bu-don — đơn KÉO BÙ (lib/dauKeoBu.ts) lập phiếu doanh thu mà KHÔNG trừ kho / thẻ kho / kho mẹ / bút toán; đơn thường
 * vẫn trừ kho + ghi sổ như cũ. Chạy hàm lập phiếu THẬT (services/orderSync) trên prisma giả ghi lại mọi lời gọi. 11/11/2026.
 * Kèm: bộ kéo bù (lib/keoBuDonSan) chạy thử không ghi gì, ghi thật chỉ nhập đơn sàn COMPLETED mà Kengi chưa có.
 *
 * Chạy: npm run check:keo-bu-don
 */
import { convertOnlineOrderToTransaction } from '../src/services/orderSync'
import { keoBuDonShopee, keoBuDonSan, nguonTikTok, xuLyDonKet, chepAnhXaCheoSan } from '../src/lib/keoBuDonSan'
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
        'skuMapping.findMany': a => {
            const eq = a?.where?.platformSku?.equals
            return eq === undefined ? anhXa.map(m => ({ platformSku: m.platformSku })) : anhXa.filter(m => m.platformSku.toLowerCase() === String(eq).toLowerCase())
        },
        'skuMapping.findFirst': a => {
            const eq = String(a?.where?.platformSku?.equals || '').toLowerCase()
            const pf = (a?.where?.OR || []).map((x: any) => x.platform)
            return anhXa.find(m => m.platformSku.toLowerCase() === eq && (pf.includes(m.platform) || (m.platform === null && pf.includes(null)))) || null
        },
        'skuMapping.create': a => { anhXa.push({ bundleId: null, ...a.data }); return a.data },
        'onlineOrderItem.findMany': a => (don.get(a.where.onlineOrderId)?.items || []).map((i: any) => ({ sku: i.sku, productId: i.productId })),
        'onlineOrderItem.deleteMany': a => { const d = don.get(a.where.onlineOrderId); const n = d?.items?.length || 0; if (d) d.items = []; return { count: n } },
    }
    const anhXa: any[] = [{ platformSku: 'MAP-1', platform: null, productId: 'p1', conversionRate: 1, bundleId: null }]
    // onlineOrder.update có kèm items.create (làm mới dòng hàng)
    rieng['onlineOrder.update'] = a => {
        const d = don.get(a.where.id); if (!d) return {}
        const { items, ...con } = a.data
        Object.assign(d, con)
        if (items?.create) d.items = items.create.map((x: any, i: number) => ({ id: d.id + '-m' + i, productId: null, ...x }))
        return d
    }
    // tìm hàng kho theo SKU không phân biệt hoa thường (đường nối thứ hai của hàm lập phiếu)
    rieng['product.findMany'] = a => {
        if (a?.select?.sku && !a.where) return [{ sku: SP.sku }]
        const eq = String(a?.where?.sku?.equals ?? a?.where?.OR?.[0]?.sku?.equals ?? '').toLowerCase()
        return eq === SP.sku.toLowerCase() ? [{ ...SP }] : []
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
            if (p === '$queryRawUnsafe' || p === '$queryRaw') return async (...a: any[]) => {
                goi.push({ m: p, a })
                // danh sách đơn kẹt của xuLyDonKet
                if (/"externalStatus" = 'COMPLETED'/.test(String(a[0]))) return [...don.values()].filter(d => d.channelId === a[1] && d.externalStatus === 'COMPLETED' && +new Date(d.createdAt) < +a[2] && !phieu.some(x => x.receiptNumber === 'ONLINE-' + d.orderNumber)).map(d => ({ id: d.id, externalOrderId: d.externalOrderId, total: d.total }))
                return []
            }
            if (p === '$executeRawUnsafe' || p === '$executeRaw') return async (...a: any[]) => { goi.push({ m: p, a }); return 0 }
            if (p === 'then') return undefined
            return model(p)
        },
    })
    return { sp, goi, don, phieu, anhXa }
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
        ca('B4 phiếu đơn thường KHÔNG bị ép ngày tạo (để CSDL đặt now())', phieu[0].createdAt === undefined)
    }
    // ── C. đơn KÉO BÙ ──
    {
        const { sp, goi, don, phieu } = taoPrisma([donMau('bu1', { note: GHI_CHU_KEO_BU, stockDeducted: true })])
        const ok = await convertOnlineOrderToTransaction(sp, 'bu1')
        const p = phieu[0]
        ca('C1 đơn kéo bù lên phiếu doanh thu đủ tiền, đúng ngày đặt', ok && p?.total === 200_000 && p?.status === 'completed' && p?.channel === 'online' && p?.receiptNumber === 'ONLINE-SPE-BU1' && +new Date(p.transactionDate) === +new Date('2026-01-15T03:00:00Z'))
        ca('C1b NGÀY TẠO phiếu kéo bù = ngày đặt đơn (không dồn về hôm kéo)', +new Date(p?.createdAt) === +new Date('2026-01-15T03:00:00Z'))
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
        ca('D6 ghi thật: đơn nối được hàng lên phiếu ngay, đơn SKU lạ đếm riêng (không giấu); không đụng kho / sổ', kq2.lenPhieu === 1 && kq2.khongNoiDuocHang === 1 && phieu.length === 2 && ghiKho(goi).length === 0 && ghiSo(goi).length === 0, ghiKho(goi).concat(ghiSo(goi)).join(','))
        ca('D7 phiếu cũ của Kengi không bị đụng', phieu[0].total === 1 && !goi.some(g => g.m === 'transaction.update' || g.m === 'transaction.updateMany'))
        const kq3 = await keoBuDonShopee(sp, { id: 'k1', name: 'Gian' }, taoSvc(), { ...O, apply: true })
        ca('D8 chạy lại: không nhập trùng', kq3.daNhap === 0 && kq3.thieu === 1 && don.size === 2, JSON.stringify({ n: kq3.daNhap, t: kq3.thieu }))
    }
    {
        const { sp } = taoPrisma()
        const kq = await keoBuDonShopee(sp, { id: 'k1', name: 'Gian' }, { lietKeMaDonTheoNgayDat: async () => ({ don: [{ sn: 'X', status: 'COMPLETED' }], chamTran: true }), layChiTietNhieuDon: async () => [] }, { ...O, apply: true })
        ca('D9 liệt kê chưa hết ⇒ dừng, không nhập phần dở', kq.chamTran && kq.daNhap === 0 && kq.loi.length === 1)
    }
    // ── E. TikTok: nguồn đơn liệt kê một lượt, mã phiếu ONLINE-TIK- ──
    {
        const { sp, phieu, don } = taoPrisma()
        phieu.push({ id: 'cu', receiptNumber: 'ONLINE-TIK-900', status: 'completed', total: 1 })
        const trang: any[][] = [[{ ...chiTiet('900'), orderNumber: 'TIK-900', platform: 'tiktok' }], [{ ...chiTiet('901'), orderNumber: 'TIK-901', platform: 'tiktok' }]]
        let lan = 0
        const svc = { fetchOrders: async (p: any) => { const r = { orders: trang[lan] || [], hasMore: lan < trang.length - 1, nextPageToken: lan < trang.length - 1 ? 'tk' + lan : undefined }; lan++; return p.status === 'COMPLETED' ? r : { orders: [], hasMore: false } } }
        const kq = await keoBuDonSan(sp, { id: 'kt', name: 'TikTok' }, nguonTikTok(svc), { ...O, apply: true })
        ca('E1 TikTok: lật hết trang, bỏ đơn đã có phiếu ONLINE-TIK-, nhập đơn thiếu', kq.trenSanHoanThanh === 2 && kq.daCoTrongKengi === 1 && kq.daNhap === 1 && kq.lenPhieu === 1 && phieu.some(p => p.receiptNumber === 'ONLINE-TIK-901') && [...don.values()][0]?.orderNumber === 'TIK-901', JSON.stringify(kq))
    }
    // ── F. đơn kẹt ──
    {
        // đơn Shopee bản cũ: dòng hàng không SKU; sàn giờ trả mã phân loại MX1
        const cu = donMau('ket1', { channelId: 'k1', externalStatus: 'COMPLETED', khongKhopSku: true, total: 150_000, items: [{ id: 'x', productId: null, productName: 'Máy xay', sku: null, quantity: 1, unitPrice: 150_000, discount: 0, lineTotal: 150_000 }] })
        const moiHon = donMau('ket2', { channelId: 'k1', externalStatus: 'COMPLETED', createdAt: new Date('2026-11-05T03:00:00Z'), items: [{ id: 'y', productId: null, productName: 'Máy xay', sku: null, quantity: 1, unitPrice: 1, discount: 0, lineTotal: 1 }] })
        const { sp, goi, don, phieu } = taoPrisma([cu, moiHon])
        const nguon = { tienTo: 'SPE-', lietKe: async () => ({ don: [], chamTran: false }), chiTiet: async (sns: string[]) => sns.map(s => chiTiet(s)) }
        const TRUOC = new Date('2026-10-31T17:00:00Z')
        const thu = await xuLyDonKet(sp, { id: 'k1', name: 'Gian', platform: 'shopee' }, nguon, { truoc: TRUOC, apply: false, hanMs: 60_000, gioiHan: 5000 })
        ca('F1 chạy thử: chỉ đơn đặt TRƯỚC mốc, ước lên phiếu được, không ghi gì', thu.donKet === 1 && thu.uocLenPhieu === 1 && phieu.length === 0 && !goi.some(g => /\.(create|update|updateMany|deleteMany|upsert)$/.test(g.m)), JSON.stringify(thu))
        const ghi = await xuLyDonKet(sp, { id: 'k1', name: 'Gian', platform: 'shopee' }, nguon, { truoc: TRUOC, apply: true, hanMs: 60_000, gioiHan: 5000 })
        const d = don.get('ket1')
        ca('F2 ghi thật: thay dòng hàng bằng bản có mã, gắn dấu kéo bù, lên phiếu', ghi.lamMoiDong === 1 && ghi.lenPhieu === 1 && ghi.tienLenPhieu === 150_000 && d.items[0].sku === 'MX1' && laDonKeoBu(d.note) && d.stockDeducted === true && phieu.length === 1 && laDonKeoBu(phieu[0].notes), JSON.stringify(ghi))
        ca('F3 đơn kẹt lên phiếu KHÔNG đụng kho / sổ', ghiKho(goi).length === 0 && ghiSo(goi).length === 0, ghiKho(goi).concat(ghiSo(goi)).join(','))
        ca('F4 đơn đặt SAU mốc không bị đụng', don.get('ket2').items[0].sku === null && !laDonKeoBu(don.get('ket2').note) && don.get('ket2').stockDeducted === false)
    }
    {
        // sàn báo đơn không còn hoàn thành ⇒ bỏ qua, không lên phiếu
        const { sp, phieu } = taoPrisma([donMau('ket3', { channelId: 'k1', externalStatus: 'COMPLETED', items: [{ id: 'z', productId: null, productName: 'X', sku: null, quantity: 1, unitPrice: 1, discount: 0, lineTotal: 1 }] })])
        const nguon = { tienTo: 'SPE-', lietKe: async () => ({ don: [], chamTran: false }), chiTiet: async (sns: string[]) => sns.map(s => chiTiet(s, 'TO_RETURN')) }
        const kq = await xuLyDonKet(sp, { id: 'k1', name: 'Gian', platform: 'shopee' }, nguon, { truoc: new Date('2026-10-31T17:00:00Z'), apply: true, hanMs: 60_000, gioiHan: 5000 })
        ca('F5 sàn nói đơn đang trả hàng ⇒ bỏ qua', kq.boQuaKhongConHoanThanh === 1 && kq.lenPhieu === 0 && phieu.length === 0)
    }
    {
        // ánh xạ chéo sàn
        const { sp, anhXa } = taoPrisma()
        anhXa.push({ platformSku: 'Ct24plus', platform: 'tiktok', productId: 'p1', conversionRate: 1, bundleId: null })
        anhXa.push({ platformSku: 'HAI-NOI', platform: 'tiktok', productId: 'p1', conversionRate: 1, bundleId: null }, { platformSku: 'hai-noi', platform: 'lazada', productId: 'p2', conversionRate: 1, bundleId: null })
        anhXa.push({ platformSku: 'COMBO', platform: 'tiktok', productId: 'p1', conversionRate: 1, bundleId: 'b1' })
        const thu = await chepAnhXaCheoSan(sp, 'shopee', ['CT24PLUS', 'HAI-NOI', 'COMBO', 'MAP-1', 'KHONG-CO'], false)
        ca('G1 chỉ chép mã mà mọi ánh xạ cùng trỏ MỘT hàng kho (không combo, chưa có ở sàn này / ánh xạ chung)', thu.length === 1 && /^CT24PLUS \(shopee\) → MX1$/.test(thu[0]) && anhXa.length === 5, JSON.stringify(thu))
        await chepAnhXaCheoSan(sp, 'shopee', ['CT24PLUS'], true)
        ca('G2 ghi thật tạo đúng một ánh xạ; chạy lại không tạo thêm', anhXa.filter(m => m.platform === 'shopee').length === 1 && (await chepAnhXaCheoSan(sp, 'shopee', ['CT24PLUS'], true)).length === 0 && anhXa.length === 6)
    }
    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
