/* Kiểm DỰNG DÒNG HOÁ ĐƠN KIOTVIET (services/kiotvietSync.ts → dungDongHoaDon) — 18/10/2026.
 *   npx tsx scripts/check-kiotviet-dong-hoa-don.ts
 * Ca thật: HUTI HD031632 (17/10) rơi dòng EDH-SZP125-E6 3.325.000đ — dựng dòng chỉ tra SKU khớp tuyệt đối, bỏ qua bảng nối mã
 * KiotViet mà đồng bộ hàng hoá dùng; đo 62 phiếu / 128,7tr. Prisma giả, không DB. */
import { dungDongHoaDon } from '../src/services/kiotvietSync'

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

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main()
