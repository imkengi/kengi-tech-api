/* Kiểm DỰNG DÒNG HOÁ ĐƠN KIOTVIET (services/kiotvietSync.ts → dungDongHoaDon) — 18/10/2026.
 *   npx tsx scripts/check-kiotviet-dong-hoa-don.ts
 * Ca thật: HUTI HD031632 (17/10) rơi dòng EDH-SZP125-E6 3.325.000đ — dựng dòng chỉ tra SKU khớp tuyệt đối, bỏ qua bảng nối mã
 * KiotViet mà đồng bộ hàng hoá dùng; đo 62 phiếu / 128,7tr. Prisma giả, không DB. */
import { dungDongHoaDon, dungDongPhieuNhap, laMaDaXoaKV, newCounters, syncPurchaseOrders, timHangKV } from '../src/services/kiotvietSync'

let loi = 0
const dung = (t: string, ok: boolean, x?: any) => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${t}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`) }

const SP = [
    { id: 'p-a', name: 'Đá cắt 107', sku: 'EDH-SZP107-E6' },
    { id: 'p-b', name: 'Đá cắt 125 (SKU Kengi khác — nối qua mã vạch)', sku: 'DACAT-125' },
]
const NOI: Record<string, string> = { '1032887971': 'p-b' }
const gia = (hong = false): any => ({
    kiotVietMap: { findUnique: async ({ where }: any) => { if (hong) throw new Error('DB cạn kết nối'); const id = NOI[where.entity_kvId.kvId]; return id ? { localId: id } : null } },
    product: {
        findUnique: async ({ where }: any) => {
            if (hong) throw new Error('DB cạn kết nối')
            return SP.find(p => (where.id ? p.id === where.id : p.sku === where.sku)) ?? null
        },
    },
})
const kv = {
    total: 7429000, discount: 0,
    invoiceDetails: [
        { productId: 1032887971, productCode: 'EDH-SZP125-E6', productName: 'Đá cắt xanh 125mm E', quantity: 10, price: 350000, discount: 17500, subTotal: 3325000 },
        { productId: 1032061016, productCode: 'EDH-SZP107-E6', productName: 'Đá cắt 107', quantity: 12, price: 360000, discount: 18000, subTotal: 4104000 },
    ],
}

async function main() {
    const r = await dungDongHoaDon(gia(), kv)
    dung('mã nối qua bảng nối (SKU Kengi khác) VẪN ra dòng', r.lines.some(l => l.productId === 'p-b' && l.quantity === 10), r.lines.map(l => l.sku))
    dung('hai dòng cộng đúng tổng phiếu', Math.round(r.lines.reduce((s, l) => s + l.lineTotal, 0)) === 7429000, r.lines.reduce((s, l) => s + l.lineTotal, 0))
    dung('không còn mã thiếu', r.missing.length === 0, r.missing)

    const r2 = await dungDongHoaDon(gia(), { ...kv, invoiceDetails: [...kv.invoiceDetails, { productId: 999, productCode: 'KHONG-CO', productName: 'Mã lạ', quantity: 1, price: 1000, subTotal: 1000 }] })
    dung('mã không có ở đâu ⇒ báo thiếu kèm mã KiotViet để kéo', r2.missing.join() === 'KHONG-CO' && r2.thieu[0]?.kvProductId === '999', r2.thieu)

    let nem = false
    try { await dungDongHoaDon(gia(true), kv) } catch { nem = true }
    dung('lỗi đọc DB ⇒ NÉM (không biến thành "không có mã" rồi rơi dòng)', nem)

    // HUTI 18/10: 32 phiếu cũ rơi dòng vì mã đã XOÁ bên KiotViet (đuôi {DEL}) — không được kéo về tạo lại
    dung('nhận mã đã xoá {DEL} / {DEL1}, không nhận mã thường', laMaDaXoaKV('L4007{DEL}') && laMaDaXoaKV('FPC20L{del1}') && !laMaDaXoaKV('L4007') && !laMaDaXoaKV('DEL-100'))

    /* PHIẾU NHẬP (18/10): cùng lỗi tra mã + dòng KV không có subTotal, `discount` là giảm MỖI CÁI (đo 599 phiếu HUTI:
     * PN004014 273.902.200 − Σ SL×giảm = 200.770.313 = tổng). Bản cũ ghi total = SL × giá. */
    const pn = { total: 3300000, discount: 0, purchaseOrderDetails: [
        { productId: 1032887971, productCode: 'EDH-SZP125-E6', productName: 'Đá cắt xanh 125mm E', quantity: 10, price: 350000, discount: 20000 },
        { productId: 1032061016, productCode: 'EDH-SZP107-E6', productName: 'Đá cắt 107', quantity: 0.5, price: 1200000, discount: 0 },
    ] }
    const p1 = await dungDongPhieuNhap(gia(), pn)
    const dongNoi = p1.lines.find(l => l.productId === 'p-b')
    dung('phiếu nhập: mã nối qua bảng nối VẪN ra dòng', !!dongNoi && p1.missing.length === 0, p1.lines.map(l => l.productSku))
    dung('phiếu nhập: giảm MỖI CÁI ⇒ giảm cả dòng 200.000, thành tiền 3.300.000 (không phải SL × giá 3.500.000)', dongNoi?.discount === 200000 && dongNoi?.total === 3300000, dongNoi)
    const dongLe = p1.lines.find(l => l.productId === 'p-a')
    dung('phiếu nhập: SL lẻ — tiền theo SL thực (600.000), cột SL làm tròn', dongLe?.total === 600000 && dongLe?.quantity === 1, dongLe)
    const p2 = await dungDongPhieuNhap(gia(), { purchaseOrderDetails: [{ productId: 999, productCode: 'KHONG-CO', quantity: 1, price: 1000 }] })
    dung('phiếu nhập: mã không có ⇒ báo thiếu kèm mã KiotViet để kéo', p2.missing.join() === 'KHONG-CO' && p2.thieu[0]?.kvProductId === '999', p2.thieu)
    let nemPn = false
    try { await dungDongPhieuNhap(gia(true), pn) } catch { nemPn = true }
    dung('phiếu nhập: lỗi đọc DB ⇒ NÉM (bản cũ .catch(() => null) ⇒ rơi dòng)', nemPn)
    dung('timHangKV: bảng nối trỏ hàng đã xoá ⇒ rơi về tra SKU', (await timHangKV({ ...gia(), kiotVietMap: { findUnique: async () => ({ localId: 'p-da-xoa' }) } }, '1', 'EDH-SZP107-E6'))?.id === 'p-a')

    /* PHIẾU NHẬP HUỶ / XOÁ BÊN KV SAU KHI ĐÃ SANG KENGI (đo HUTI 18/10: 8 phiếu 98,9tr status 4) — trước đây nhánh "đã có" chỉ
     * đụng thanh toán rồi bỏ qua IM LẶNG. Nay phải báo rõ; phiếu Kengi đã huỷ / chưa từng có thì vẫn bỏ qua như cũ. */
    const PN: Record<string, any> = {
        PN1: { id: 'r1', status: 'completed', totalCost: 1000, paidAmount: 0, paymentStatus: 'unpaid' },
        PN2: { id: 'r2', status: 'completed', totalCost: 2000, paidAmount: 0, paymentStatus: 'unpaid' },
        PN3: { id: 'r3', status: 'cancelled', totalCost: 3000, paidAmount: 0, paymentStatus: 'unpaid' },
    }
    const spPN: any = { ...gia(), storeSettings: { findFirst: async () => ({ businessType: 'company' }) },
        importReceipt: { findUnique: async ({ where }: any) => PN[where.code] ?? null } }
    const cPN = newCounters()
    await syncPurchaseOrders(spPN, [
        { id: 1, code: 'PN1', status: 4, total: 1000 },
        { id: 2, code: 'PN2{DEL}', status: 4, total: 2000 },
        { id: 3, code: 'PN3', status: 4, total: 3000 },
        { id: 4, code: 'PN4', status: 4, total: 4000 },
        { id: 5, code: 'PN5', status: 3, total: 3300000, purchaseOrderDetails: pn.purchaseOrderDetails.slice(0, 1) },
    ], { apply: false } as any, cPN)
    const bao = cPN.errors.join(' | ')
    dung('phiếu KV huỷ (status 4) mà Kengi còn giữ ⇒ BÁO "ĐÃ HUỶ"', /PN1: ĐÃ HUỶ \(status 4\)/.test(bao), cPN.errors)
    dung('phiếu KV xoá ({DEL}) mà Kengi còn giữ ⇒ BÁO "ĐÃ XOÁ" theo mã gốc', /PN2: ĐÃ XOÁ/.test(bao))
    dung('Kengi đã huỷ / chưa từng có ⇒ bỏ qua im lặng như cũ', !/PN3|PN4/.test(bao) && cPN.skipped === 4, { skipped: cPN.skipped })
    dung('phiếu hoàn thành mới vẫn tạo bình thường (chạy thử)', cPN.created === 1 && cPN.failed === 0, { created: cPN.created, failed: cPN.failed })

    /* SỬA phiếu bên KV = xoá bản cũ thành "PN6_1015005760{DEL}" + tạo bản mới CÙNG mã (đo HUTI 18/10, PN003958) ⇒ bản {DEL} có bản
     * sống cùng mã là bản bị THAY — không được báo "đã xoá". Còn phiếu đã có mà tổng KV khác ⇒ báo "ĐÃ SỬA", không tự đổi. */
    PN.PN6 = { id: 'r6', status: 'completed', totalCost: 2570400, paidAmount: 0, paymentStatus: 'unpaid' }
    PN.PN7 = { id: 'r7', status: 'completed', totalCost: 500, paidAmount: 0, paymentStatus: 'unpaid' }
    const cSua = newCounters()
    await syncPurchaseOrders(spPN, [
        { id: 61, code: 'PN6_1015005760{DEL}', status: 4, total: 2570400 },
        { id: 62, code: 'PN6', status: 3, total: 16087838, totalPayment: 0 },
        { id: 71, code: 'PN7_1015009999{DEL}', status: 4, total: 500 },
    ], { apply: false } as any, cSua)
    const baoSua = cSua.errors.join(' | ')
    dung('bản {DEL} bị THAY (có bản sống cùng mã) ⇒ im lặng', !/PN6: ĐÃ XOÁ/.test(baoSua), cSua.errors)
    dung('phiếu đã có mà tổng KV khác ⇒ báo "ĐÃ SỬA … 2570400 → 16087838"', /PN6: ĐÃ SỬA bên KiotViet sau khi đồng bộ — tổng 2570400 → 16087838/.test(baoSua))
    dung('xoá thật dạng "_<id>{DEL}" (không có bản sống) ⇒ báo "ĐÃ XOÁ" theo mã gốc', /PN7: ĐÃ XOÁ/.test(baoSua))

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main()
