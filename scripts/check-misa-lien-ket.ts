/* Kiểm LIÊN KẾT HÀNG HOÁ KENGI ↔ MISA + kế hoạch đẩy hoá đơn (lib/misaLienKet.ts, services/misaPush.ts) — 19/10/2026.
 *   npx tsx scripts/check-misa-lien-ket.ts
 * Trang Vận Hành › "Đẩy HĐ sang MISA": mã HUTI đến từ KiotViet, phần lớn không trùng mã vật tư MISA; MISA lưu khách theo MST.
 * Prisma giả, không DB, không gọi MISA. */
import { dungChiMuc, goiYVatTu, timVatTu, trangThaiLienKet, noiHang, nhapLienKetPrtcode } from '../src/lib/misaLienKet'
import { lapKeHoach, docCaiDat, tenKhongDau, tenNguoiTieuDung, cungDvt, type DanhMucMisa } from '../src/services/misaPush'

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
    /* Chủ shop 19/10/2026: khách chưa có MST xuất "Bán cho người tiêu dùng (Tên khách)", KHÔNG lưu mã khách hàng */
    const d3 = kh.dong.find(d => d.localId === '3')!
    dung('khách KHÔNG MST ⇒ người mua "Bán cho người tiêu dùng (Tên khách)", phiếu sẵn sàng',
        d3.trangThai === 'san_sang' && d3.payload?.account_object_name === 'Bán cho người tiêu dùng (Cty)', { tt: d3.trangThai, ten: d3.payload?.account_object_name, lyDo: d3.lyDo })
    dung('…KHÔNG mã đối tượng, không địa chỉ / MST — cả đầu phiếu lẫn dòng hàng',
        !('account_object_code' in (d3.payload || {})) && d3.payload?.account_object_tax_code === undefined && d3.payload?.account_object_address === undefined
        && d3.payload?.detail?.[0]?.account_object_code === undefined && d3.payload?.detail?.[0]?.account_object_name === 'Bán cho người tiêu dùng (Cty)', d3.payload?.detail?.[0])
    dung('tên người mua: có tên ⇒ kèm ngoặc; "Khách lẻ" / trống ⇒ chỉ "Bán cho người tiêu dùng"',
        tenNguoiTieuDung('  Chị  Lan ') === 'Bán cho người tiêu dùng (Chị Lan)' && tenNguoiTieuDung('Khách lẻ') === 'Bán cho người tiêu dùng'
        && tenNguoiTieuDung('KHÁCH LẺ') === 'Bán cho người tiêu dùng' && tenNguoiTieuDung('') === 'Bán cho người tiêu dùng')
    dung('tên đối tượng so bỏ dấu, không phân biệt hoa thường, gộp khoảng trắng (tìm đối tượng ở admin)', tenKhongDau('BÁN CHO  người TIÊU DÙNG ') === 'ban cho nguoi tieu dung')

    // khách lẻ (không gắn khách) dùng tên ghi trên phiếu; khách không MST có "người mua hàng" trên hồ sơ thì lấy tên đó
    const txLe = { ...tx('4', '', 'x'), customerId: null, customer: null, customerName: 'Anh Tư' }
    const txNm = tx('5', '', 'KH0005'); txNm.customer = { ...txNm.customer, name: 'Đại lý Tư Phát', invoiceBuyerName: 'Nguyễn Văn Tư' } as any
    const spLe: any = { ...spKh, transaction: { count: async () => 2, findMany: async () => [txLe, txNm] } }
    const kLe = await lapKeHoach(spLe, {} as any, caiDat, dm, { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's' })
    dung('phiếu không gắn khách ⇒ "Bán cho người tiêu dùng (tên trên phiếu)", không mã',
        kLe.dong[0].trangThai === 'san_sang' && kLe.dong[0].payload?.account_object_name === 'Bán cho người tiêu dùng (Anh Tư)' && kLe.dong[0].payload?.account_object_code === undefined, kLe.dong[0].payload?.account_object_name)
    dung('khách không MST có "người mua hàng" trên hồ sơ ⇒ lấy tên người mua',
        kLe.dong[1].payload?.account_object_name === 'Bán cho người tiêu dùng (Nguyễn Văn Tư)', kLe.dong[1].payload?.account_object_name)

    /* THEO MẪU CHỨNG TỪ CHỦ SHOP GỬI 19/10/2026: 4 × 480.000 (giá đã gồm thuế 8%) ⇒ đơn giá 444.444,44 · thành tiền 1.777.777,76
     * · thuế 142.222,22; kèm hoá đơn (sa_invoice 11/3560), phiếu xuất kho (8/2020), inventory_item_id / unit_id / stock_id, reference */
    const dmMau: DanhMucMisa = {
        ...dm,
        vatTuTheoMa: new Map([['SHD8611N', { id: 'vt-shd', ma: 'SHD8611N', ten: 'Nồi cơm điện 1.8L Sunhouse SHD8611N', dvt: 'Cái', unitId: 'u-cai' }]]),
        vatTuTheoId: new Map([['vt-shd', 'SHD8611N']]),
        kho: [{ id: 'k-hh', ma: 'HH', ten: 'Kho Hàng' }],
    }
    const txMau = { ...tx('6', '', 'x'), customerId: null, customer: null, customerName: '', total: 1920000, subtotal: 1920000,
        payments: [{ type: 'cash', amount: 1920000 }], amountReceived: 1920000,
        items: [{ productId: 'p-shd', productName: 'Nồi cơm điện 1.8L Sunhouse SHD8611N', quantity: 4, unitPrice: 480000, lineTotal: 1920000,
            product: { id: 'p-shd', sku: 'SHD8611N', name: 'Nồi cơm', baseUnit: 'cái' } }] }
    const spMau: any = { ...spKh, transaction: { count: async () => 1, findMany: async () => [txMau] } }
    const kMau = await lapKeHoach(spMau, {} as any, caiDat, dmMau, { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's' })
    const pMau = kMau.dong[0].payload, dMau = pMau?.detail?.[0]
    dung('mẫu: tách thuế 8% giá đã gồm thuế — 444.444,44 · 1.777.777,76 · 142.222,22 (đúng số trong mẫu)',
        dMau?.unit_price === 444444.44 && dMau?.amount === 1777777.76 && dMau?.amount_oc === 1777777.76 && dMau?.vat_rate === 8 && dMau?.vat_amount === 142222.22,
        dMau && { u: dMau.unit_price, a: dMau.amount, v: dMau.vat_amount })
    dung('mẫu: mã định danh MISA trên dòng — inventory_item_id / unit_id / stock_id, ĐVT theo MISA',
        dMau?.inventory_item_id === 'vt-shd' && dMau?.unit_id === 'u-cai' && dMau?.stock_id === 'k-hh' && dMau?.unit_name === 'Cái',
        dMau && { i: dMau.inventory_item_id, u: dMau.unit_id, s: dMau.stock_id, n: dMau.unit_name })
    // HD031660 19/10: MISA "Cái" (dựng sẵn) và Kengi "Cái" (tổ hợp dấu) nhìn y hệt mà so thường ra KHÁC ⇒ cảnh báo oan
    dung('ĐVT: cùng chữ khác dạng mã hoá Unicode / hoa thường ⇒ coi là một, không cảnh báo lệch',
        cungDvt('Cái'.normalize('NFD'), 'cái'.normalize('NFC')) && !cungDvt('Cái', 'Hộp') && !kMau.dong[0].canhBao.some(c => c.startsWith('ĐVT khác MISA')), kMau.dong[0].canhBao)
    dung('mẫu: thu tiền mặt ⇒ reftype 3531, is_paid, Nợ 1111 / Có 5111',
        pMau?.reftype === 3531 && pMau?.is_paid === true && dMau?.debit_account === '1111' && dMau?.credit_account === '5111')
    dung('mẫu: kèm hoá đơn — include_invoice 1, sa_invoice (11 / 3560, is_get_new_id, is_posted), inv_date',
        pMau?.include_invoice === 1 && pMau?.sa_invoice?.voucher_type === 11 && pMau?.sa_invoice?.reftype === 3560 && pMau?.sa_invoice?.is_get_new_id === true
        && pMau?.sa_invoice?.is_posted === true && pMau?.inv_date === '2026-10-18', pMau?.sa_invoice)
    dung('mẫu: phiếu xuất kho (8 / 2020, ghi sổ tài chính + sổ kho), ngày YYYY-MM-DD, is_posted_finance, display_on_book 2',
        pMau?.in_outward?.voucher_type === 8 && pMau?.in_outward?.reftype === 2020 && pMau?.in_outward?.is_posted_inventory_book_finance === true
        && pMau?.refdate === '2026-10-18' && pMau?.posted_date === '2026-10-18' && pMau?.is_posted_finance === true && pMau?.display_on_book === 2, pMau?.in_outward)
    const thamChieu = kMau.dong[0].thamChieu || []
    dung('mẫu: reference nối phiếu xuất kho + hoá đơn về phiếu bán (org_refer_refid = org_refid phiếu bán)',
        thamChieu.length === 2 && thamChieu.every((r: any) => r.org_refer_refid === pMau?.org_refid && r.org_refer_reftype === 3531)
        && thamChieu[0].org_reftype === 2020 && thamChieu[1].org_reftype === 3560 && thamChieu[0].org_refid === pMau?.in_outward?.refid, thamChieu)
    dung('mẫu: tổng chứng từ = Σ dòng (1.919.999,98 — lệch làm tròn 2 số lẻ như mẫu, không cảnh báo)',
        pMau?.total_amount === 1919999.98 && pMau?.total_vat_amount === 142222.22 && !kMau.dong[0].canhBao.some(c => c.startsWith('Tổng thanh toán')), pMau?.total_amount)

    // chiết khấu gộp vào đơn giá (mẫu không có cột chiết khấu): HD031660 — 2 × 302.400, giảm 6% ⇒ còn 568.512
    const txCk = { ...txMau, id: 't-ck', total: 568512, subtotal: 568512, payments: [], amountReceived: 0,
        items: [{ ...txMau.items[0], quantity: 2, unitPrice: 302400, lineTotal: 568512 }] }
    const kCk = await lapKeHoach({ ...spMau, transaction: { count: async () => 1, findMany: async () => [txCk] } }, {} as any, caiDat, dmMau,
        { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's' })
    const dCk = kCk.dong[0].payload?.detail?.[0]
    dung('chiết khấu gộp vào đơn giá trước thuế — 263.200 · 526.400 + 42.112 = 568.512, không cột chiết khấu',
        dCk?.unit_price === 263200 && dCk?.amount === 526400 && dCk?.vat_amount === 42112 && dCk?.discount_amount === 0 && kCk.dong[0].payload?.total_amount === 568512,
        dCk && { u: dCk.unit_price, a: dCk.amount, v: dCk.vat_amount })
    dung('chưa thu tiền ⇒ reftype 3530, is_paid false, Nợ 131',
        kCk.dong[0].payload?.reftype === 3530 && kCk.dong[0].payload?.is_paid === false && dCk?.debit_account === '131')

    // tắt kèm hoá đơn / không ghi thuế
    const caiDatTat = docCaiDat(JSON.stringify({ branchId: 'cn1', maKho: 'HH', kemHoaDon: false, thueSuat: null }))
    const kTat = await lapKeHoach(spMau, {} as any, caiDatTat, dmMau, { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's' })
    const pTat = kTat.dong[0].payload
    dung('Thiết lập tắt kèm hoá đơn + không ghi thuế ⇒ include_invoice 0, không sa_invoice, giá giữ nguyên, thuế 0',
        pTat?.include_invoice === 0 && !pTat?.sa_invoice && pTat?.detail?.[0]?.unit_price === 480000 && pTat?.detail?.[0]?.vat_amount === 0 && pTat?.detail?.[0]?.vat_rate === undefined,
        pTat?.detail?.[0])
    dung('thiết lập thuế: mặc định 8 · gồm thuế · kèm HĐ; giá trị lạ ⇒ 8; null giữ null',
        docCaiDat(null).thueSuat === 8 && docCaiDat(null).giaGomThue === true && docCaiDat(null).kemHoaDon === true
        && docCaiDat(JSON.stringify({ thueSuat: 7 })).thueSuat === 8 && docCaiDat(JSON.stringify({ thueSuat: 10 })).thueSuat === 10
        && docCaiDat(JSON.stringify({ thueSuat: null })).thueSuat === null)

    // khách CÓ MST mà MISA chưa có ⇒ tạo đối tượng (mã = MST) trước khi gửi phiếu, phiếu sẵn sàng
    const txMoi = tx('7', '0311111111', 'KH0007')
    txMoi.customer = { ...txMoi.customer, name: 'Cty Mới', invoiceCompanyName: 'CÔNG TY TNHH MỚI', invoiceAddress: '1 Lê Lợi' } as any
    const kMoi = await lapKeHoach({ ...spKh, transaction: { count: async () => 1, findMany: async () => [txMoi] } }, {} as any, caiDat, dm,
        { loai: 'banhang', tu: new Date('2026-10-01'), den: new Date('2026-10-19'), schema: 's' })
    const tdMoi = kMoi.dong[0].tuDien?.[0]
    dung('khách MST chưa có trên MISA ⇒ phiếu sẵn sàng + đối tượng tạo kèm (mã = MST, tên công ty, địa chỉ HĐ, tổ chức)',
        kMoi.dong[0].trangThai === 'san_sang' && kMoi.dong[0].payload?.account_object_code === '0311111111' && tdMoi?.payload?.account_object_code === '0311111111'
        && tdMoi?.payload?.dictionary_type === 1 && tdMoi?.payload?.account_object_name === 'CÔNG TY TNHH MỚI' && tdMoi?.payload?.address === '1 Lê Lợi'
        && tdMoi?.payload?.company_tax_code === '0311111111' && tdMoi?.payload?.account_object_type === 0 && tdMoi?.localId === 'kh:c-7',
        { tt: kMoi.dong[0].trangThai, lyDo: kMoi.dong[0].lyDo, td: tdMoi?.payload })

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main()
