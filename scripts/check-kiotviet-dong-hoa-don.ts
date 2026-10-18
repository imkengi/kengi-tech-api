/* Kiểm DỰNG DÒNG HOÁ ĐƠN KIOTVIET (services/kiotvietSync.ts → dungDongHoaDon) — 18/10/2026.
 *   npx tsx scripts/check-kiotviet-dong-hoa-don.ts
 * Ca thật: HUTI HD031632 (17/10) rơi dòng EDH-SZP125-E6 3.325.000đ — dựng dòng chỉ tra SKU khớp tuyệt đối, bỏ qua bảng nối mã
 * KiotViet mà đồng bộ hàng hoá dùng; đo 62 phiếu / 128,7tr. Prisma giả, không DB. */
import { dungDongHoaDon, dungDongPhieuNhap, laMaDaXoaKV, timHangKV } from '../src/services/kiotvietSync'

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

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main()
