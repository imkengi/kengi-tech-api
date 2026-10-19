/* Kiểm LIÊN KẾT HÀNG HOÁ KENGI ↔ MISA + kế hoạch đẩy hoá đơn (lib/misaLienKet.ts, services/misaPush.ts) — 19/10/2026.
 *   npx tsx scripts/check-misa-lien-ket.ts
 * Trang Vận Hành › "Đẩy HĐ sang MISA": mã HUTI đến từ KiotViet, phần lớn không trùng mã vật tư MISA; MISA lưu khách theo MST.
 * Prisma giả, không DB, không gọi MISA. */
import { dungChiMuc, goiYVatTu, timVatTu, trangThaiLienKet, noiHang, nhapLienKetPrtcode } from '../src/lib/misaLienKet'
import { lapKeHoach, docCaiDat, tenKhongDau, TEN_TIEU_DUNG, type DanhMucMisa } from '../src/services/misaPush'

let loi = 0
const dung = (t: string, ok: boolean, x?: any) => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${t}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`) }

const VT = [
    { id: 'id-0020', ma: '0020', ten: 'Ổ QUAY PHÍP 5M 0020', dvt: 'Cái' },
    { id: 'id-125', ma: 'DCX125', ten: 'Đá cắt xanh 125mm E', dvt: 'Hộp' },
    { id: 'id-107', ma: 'DC107', ten: 'Đá cắt 107', dvt: 'Viên' },
    { id: 'id-noi', ma: 'NCD28', ten: 'Nồi chống dính Kim Cương 2.8', dvt: 'Cái', ngung: true },
]
const dm: DanhMucMisa = {
    vatTuTheoMa: new Map(VT.map(v => [v.ma.toUpperCase(), v])),
    vatTuTheoId: new Map(VT.map(v => [v.id, v.ma])),
    doiTuongTheoMa: new Map([
        ['0102373667', { id: 'dt-1', ma: '0102373667', ten: 'CÔNG TY TNHH ĐIỆN HƯNG', laKhach: true, laNcc: false }],
        ['KHLE', { id: 'dt-2', ma: 'KHLE', ten: 'Khách lẻ', laKhach: true, laNcc: false }],
        ['BCNTD', { id: 'dt-3', ma: 'BCNTD', ten: 'Bán cho người tiêu dùng', laKhach: true, laNcc: false }],
    ]),
    doiTuongTheoId: new Map([['dt-1', '0102373667'], ['dt-2', 'KHLE'], ['dt-3', 'BCNTD']]),
    doiTuongTheoMst: new Map([['0102373667', ['0102373667']], ['0309999999', ['A1', 'A2']]]),
    tieuDung: { ma: 'BCNTD', ten: 'Bán cho người tiêu dùng' },
    kho: [{ id: 'k1', ma: 'HH', ten: 'Kho hàng hoá' }],
    chiNhanh: [{ id: 'cn1', ma: 'HTSG', ten: 'HƯNG TÍN SG', loai: 2 }],
    layLuc: Date.now(), canhBao: [],
}

// ── Prisma giả: Product + MisaMap + KiotVietMap ──
const SP = [
    { id: 'p-a', sku: 'EDH-SZP107-E6', name: 'Đá cắt 107', baseUnit: 'Viên' },
    { id: 'p-b', sku: '0020', name: 'Ổ quay phíp 5m', baseUnit: 'Cái' },
    { id: 'p-c', sku: 'XYZ', name: 'Hàng nối hỏng', baseUnit: 'Cái' },
    { id: 'p-d', sku: 'EDH-SZP125-E6', name: 'Đá cắt xanh 125mm E (Hộp)', baseUnit: 'Hộp' },
    { id: 'p-e', sku: 'EDH-SZP125-E7', name: 'Đá cắt xanh 125mm (bản 2)', baseUnit: 'Hộp' },
]
let MAP: any[] = [
    { entity: 'product', misaId: 'id-107', misaCode: 'DC107', localId: 'p-a' },
    { entity: 'product', misaId: 'id-da-xoa', misaCode: 'OLD1', localId: 'p-c' },
]
const KVMAP = [{ entity: 'product', kvCode: 'KV-125', localId: 'p-d' }]
const khop = (r: any, w: any) => Object.entries(w || {}).every(([k, v]: any) => {
    if (k === 'NOT') return !khop(r, v)
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(r[k])
    return r[k] === v
})
const sp: any = {
    product: {
        findUnique: async ({ where }: any) => SP.find(p => (where.id ? p.id === where.id : p.sku === where.sku)) ?? null,
        findMany: async ({ where }: any) => SP.filter(p => khop(p, where)),
    },
    misaMap: {
        findMany: async ({ where }: any) => MAP.filter(r => khop(r, where)),
        findUnique: async ({ where }: any) => MAP.find(r => r.entity === where.entity_misaId.entity && r.misaId === where.entity_misaId.misaId) ?? null,
        deleteMany: async ({ where }: any) => { const n = MAP.length; MAP = MAP.filter(r => !khop(r, where)); return { count: n - MAP.length } },
        upsert: async ({ where, create, update }: any) => {
            const r = MAP.find(x => x.entity === where.entity_misaId.entity && x.misaId === where.entity_misaId.misaId)
            if (r) Object.assign(r, update); else MAP.push({ ...create })
        },
    },
    kiotVietMap: { findMany: async ({ where }: any) => KVMAP.filter(r => khop(r, where)) },
    $transaction: async (fn: any) => fn(sp),
}

async function main() {
    // 1. Gợi ý theo tên — từ hiếm nặng ký
    const cm = dungChiMuc(dm)
    const g = goiYVatTu(cm, 'Đá cắt xanh 125mm E (Hộp)', 'EDH-SZP125-E6')
    dung('gợi ý: "Đá cắt xanh 125mm E (Hộp)" ⇒ DCX125 đứng đầu', g[0]?.ma === 'DCX125', g)
    dung('gợi ý: hàng không liên quan ⇒ không gợi ý bừa', goiYVatTu(cm, 'Bóng đèn LED 9W', 'BD9W').length === 0)
    dung('tìm tay: "0020" ⇒ mã khớp đúng lên đầu', timVatTu(cm, '0020')[0]?.ma === '0020')
    dung('tìm tay: "da cat" (không dấu) ⇒ ra cả hai đá cắt', timVatTu(cm, 'da cat').length === 2)

    // 2. Trạng thái liên kết
    const lk = await trangThaiLienKet(sp, dm, SP)
    dung('nối tay ⇒ "noi" (DC107)', lk.get('p-a')?.kieu === 'noi' && lk.get('p-a')?.vt?.ma === 'DC107')
    dung('SKU trùng mã MISA ⇒ "trung-ma", không cần ghi', lk.get('p-b')?.kieu === 'trung-ma')
    dung('nối tới vật tư MISA đã xoá ⇒ "noi-hong"', lk.get('p-c')?.kieu === 'noi-hong')
    dung('không có gì ⇒ "chua"', lk.get('p-d')?.kieu === 'chua')

    // 3. Nối / xung đột / chuyển
    const n1 = await noiHang(sp, dm, 'p-d', 'dcx125')
    dung('nối p-d → DCX125 (không phân biệt hoa thường)', n1.ok === true && (n1 as any).vt.ma === 'DCX125')
    const n2 = await noiHang(sp, dm, 'p-e', 'DCX125')
    dung('nối p-e vào vật tư đang thuộc p-d ⇒ XUNG ĐỘT, không cướp', n2.ok === false && (n2 as any).xungDot?.productId === 'p-d')
    const n3 = await noiHang(sp, dm, 'p-e', 'DCX125', true)
    dung('xác nhận chuyển ⇒ vật tư sang p-e, p-d mất nối', n3.ok === true && MAP.filter(r => r.misaId === 'id-125').length === 1 && MAP.find(r => r.misaId === 'id-125')?.localId === 'p-e')
    await noiHang(sp, dm, 'p-a', 'DCX125', true)
    dung('một hàng chỉ một mã MISA: nối p-a sang DCX125 thì nối cũ DC107 bị bỏ', !MAP.some(r => r.localId === 'p-a' && r.misaId === 'id-107'))
    const n4 = await noiHang(sp, dm, 'p-a', 'KHONG-CO')
    dung('mã không có trên MISA ⇒ báo lỗi, không ghi', n4.ok === false && !(n4 as any).xungDot)

    // 4. Nhập PRTCODE (chạy thử) — hàng tra theo kvCode TRƯỚC rồi SKU
    MAP = []
    const truocNhap = MAP.length
    const nh = await nhapLienKetPrtcode(sp, dm, [
        { maMisa: 'DCX125', maKv: 'KV-125' },            // kvCode → p-d
        { maMisa: 'DC107', maKv: 'EDH-SZP107-E6' },      // SKU → p-a
        { maMisa: 'KHONG-CO', maKv: 'EDH-SZP107-E6' },
        { maMisa: '0020', maKv: 'KHONG-THAY' },
        { maMisa: '0020', maKv: '0020' },                // SKU trùng mã sẵn
        { maMisa: '', maKv: 'X' },
    ], { apply: false })
    dung('nhập: kvCode → hàng Kengi (se-noi)', nh.ds[0].viec === 'se-noi' && nh.ds[0].hang?.includes('EDH-SZP125-E6'), nh.ds[0])
    dung('nhập: SKU → hàng Kengi (se-noi)', nh.ds[1].viec === 'se-noi')
    dung('nhập: mã MISA không có / mã KV không thấy / dòng trống / trùng mã sẵn — phân loại đúng',
        nh.ds[2].viec === 'khong-co-tren-misa' && nh.ds[3].viec === 'khong-thay-hang-kengi' && nh.ds[4].viec === 'trung-ma-san' && nh.ds[5].viec === 'dong-trong', nh.dem)
    dung('nhập CHẠY THỬ không ghi gì', MAP.length === truocNhap)
    await nhapLienKetPrtcode(sp, dm, [{ maMisa: 'DCX125', maKv: 'KV-125' }], { apply: true })
    dung('nhập GHI THẬT ⇒ có dòng nối', MAP.some(r => r.misaId === 'id-125' && r.localId === 'p-d'))

    // 5. Kế hoạch đẩy hoá đơn: lọc Lấy HĐ + khớp khách theo MST + mã hàng qua liên kết
    let whereNhan: any = null
    const tx = (id: string, mst: string, code: string) => ({
        id, receiptNumber: `HD-${id}`, status: 'completed', createdAt: new Date('2026-10-18T03:00:00Z'), transactionDate: null,
        total: 1000000, subtotal: 1000000, tax: 0, discount: 0, amountReceived: 0, payments: [],
        customerId: `c-${id}`, customerName: 'x',
        customer: { id: `c-${id}`, code, name: 'Cty', taxCode: mst, invoiceType: 'company', invoiceCompanyName: 'Cty', address: '', invoiceAddress: '' },
        items: [{ productId: 'p-d', productName: 'Đá cắt', quantity: 1, unitPrice: 1000000, lineTotal: 1000000, product: { id: 'p-d', sku: 'EDH-SZP125-E6', name: 'Đá cắt', baseUnit: 'Hộp' } }],
    })
    const spKh: any = {
        ...sp,
        transaction: {
            count: async () => 3,
            findMany: async ({ where }: any) => { whereNhan = where; return [tx('1', '0102373667', 'KH0001'), tx('2', '0309999999', 'KH0002'), tx('3', '', 'KH0003')] },
        },
        misaPushItem: { findMany: async () => [] },
    }
    const caiDat = docCaiDat(JSON.stringify({ branchId: 'cn1', maKho: 'HH' }))
    const kh = await lapKeHoach(spKh, {} as any, caiDat, dm, { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's', chiLayHoaDon: true, ids: ['1', '2', '3'] })
    dung('kế hoạch: lọc đúng phiếu Lấy HĐ + đúng id chọn', whereNhan?.layHoaDon === true && JSON.stringify(whereNhan?.id) === JSON.stringify({ in: ['1', '2', '3'] }), whereNhan)
    const d1 = kh.dong.find(d => d.localId === '1')!
    dung('khách mã KiotViet KH0001 không có bên MISA ⇒ khớp theo MST 0102373667, phiếu sẵn sàng', d1.trangThai === 'san_sang' && d1.payload?.account_object_code === '0102373667' && d1.canhBao.some(c => c.includes('MST')), { tt: d1.trangThai, lyDo: d1.lyDo })
    dung('mã hàng lấy qua liên kết (p-d → DCX125), đúng mã gốc MISA', d1.payload?.detail?.[0]?.inventory_item_code === 'DCX125')
    const d2 = kh.dong.find(d => d.localId === '2')!
    dung('MST ứng NHIỀU đối tượng MISA ⇒ không tự chọn, phiếu "thiếu"', d2.trangThai === 'thieu' && d2.lyDo.some(l => l.includes('không tự chọn')), d2.lyDo)
    /* Chủ shop 19/10/2026: "những khách chưa có MST sẽ xuất sang dạng Bán cho người tiêu dùng" */
    const d3 = kh.dong.find(d => d.localId === '3')!
    dung('khách KHÔNG MST ⇒ đối tượng "Bán cho người tiêu dùng" (tự nhận theo tên), phiếu sẵn sàng',
        d3.trangThai === 'san_sang' && d3.payload?.account_object_code === 'BCNTD' && d3.canhBao.some(c => c.includes('Bán cho người tiêu dùng')), { tt: d3.trangThai, lyDo: d3.lyDo })
    dung('…không mang tên / địa chỉ / MST của khách lên MISA, tên khách thật vẫn ở diễn giải',
        d3.payload?.account_object_name === 'Bán cho người tiêu dùng' && d3.payload?.account_object_tax_code === undefined && d3.payload?.account_object_address === undefined
        && d3.payload?.detail?.[0]?.account_object_name === 'Bán cho người tiêu dùng' && String(d3.payload?.journal_memo).includes('Cty'), { ten: d3.payload?.account_object_name, memo: d3.payload?.journal_memo })
    dung('tên đối tượng so bỏ dấu, không phân biệt hoa thường, gộp khoảng trắng', tenKhongDau('BÁN CHO  người TIÊU DÙNG ') === TEN_TIEU_DUNG)

    // khách lẻ (không gắn khách) cũng đi "Bán cho người tiêu dùng"; mã đặt ở Thiết lập thắng mã tự nhận
    const txLe = { ...tx('4', '', 'x'), customerId: null, customer: null }
    const spLe: any = { ...spKh, transaction: { count: async () => 1, findMany: async () => [txLe] } }
    const kLe = await lapKeHoach(spLe, {} as any, caiDat, dm, { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's' })
    dung('phiếu không gắn khách ⇒ "Bán cho người tiêu dùng"', kLe.dong[0].trangThai === 'san_sang' && kLe.dong[0].payload?.account_object_code === 'BCNTD', kLe.dong[0].lyDo)
    const caiDatLe = docCaiDat(JSON.stringify({ branchId: 'cn1', maKho: 'HH', maKhachLe: 'KHLE' }))
    const kLe2 = await lapKeHoach(spLe, {} as any, caiDatLe, dm, { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's' })
    dung('Thiết lập đặt mã riêng (KHLE) ⇒ dùng mã đó thay mã tự nhận', kLe2.dong[0].payload?.account_object_code === 'KHLE', kLe2.dong[0].payload?.account_object_code)
    const kLe3 = await lapKeHoach(spLe, {} as any, caiDat, { ...dm, tieuDung: null }, { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's' })
    dung('MISA chưa có đối tượng "Bán cho người tiêu dùng", Thiết lập trống ⇒ "thiếu", nói rõ phải tạo', kLe3.dong[0].trangThai === 'thieu' && kLe3.dong[0].lyDo.some(l => l.includes('Bán cho người tiêu dùng')), kLe3.dong[0].lyDo)

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main()
