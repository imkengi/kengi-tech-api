/**
 * SOÁT TRƯỜNG LẠC — cột có trong CSDL nhưng THIẾU ở lớp zod ⇒ sửa xong không lưu.
 *
 * Bệnh (chủ shop báo 21/08/2026: "sửa NCC xong không lưu"):
 *   `validate.ts` làm `req.body = result.data` — zod THAY HẲN body bằng phần đã lọc, nên
 *   khoá nào không khai trong schema sẽ bị **CẮT**. Route destructure ra `undefined`, và
 *   Prisma hiểu `undefined` là "đừng đổi trường này" ⇒ **lặng lẽ bỏ qua**, trả 200 OK.
 *
 *   Ca thật: schema khai `contactPerson`/`note` trong khi CSDL là `contactName`/`notes`.
 *   Zod nhận thứ KHÔNG AI GỬI và cắt thứ MỌI NƠI GỬI (web 4 file + Android 27 file).
 *   Không có lỗi nào báo, không có log nào ghi.
 *
 * Bộ soát này so tên cột CSDL với tên khoá zod cho từng model có schema Create*.
 *
 * ⚠ KHÔNG phải trường nào cũng nên cho sửa: `totalOrders`/`totalValue` là số tổng hợp,
 * cho sửa tay là sai. Những trường như vậy khai vào `KHONG_CHO_SUA` KÈM LÝ DO — khai bừa
 * vào đó là tự bịt mắt mình.
 *
 * Mã thoát: 0 = sạch · 1 = có trường lạc · 2 = KHÔNG SOI ĐƯỢC (đọc hỏng ≠ sạch)
 */
import * as fs from 'fs'
import * as path from 'path'

const GOC = path.resolve(__dirname, '..')

/** model → tên schema zod. Thêm model mới thì thêm ở đây. */
const CAP: Array<{ model: string; schema: string }> = [
    { model: 'Supplier', schema: 'CreateSupplierSchema' },
    { model: 'Customer', schema: 'CreateCustomerSchema' },
    { model: 'Product', schema: 'CreateProductSchema' },
]

/** Trường CỐ Ý không cho sửa tay — phải ghi lý do. */
const KHONG_CHO_SUA: Record<string, string> = {
    'Supplier.totalOrders': 'số tổng hợp từ phiếu nhập, không phải người dùng gõ',
    'Supplier.totalValue': 'số tổng hợp từ phiếu nhập',
    'Customer.totalSpent': 'số tổng hợp từ phiếu bán',
    'Customer.totalOrders': 'số tổng hợp từ phiếu bán',
    'Customer.debt': 'bản sao công nợ từ KiotViet — sửa tay là drift (xem kiotviet-debt-drift)',
    'Product.stock': 'tồn kho đi qua phiếu/thẻ kho, không sửa thẳng',
    // Đo 21/08: form sửa khách chỉ gửi name/phone/email/address/notes/birthday/gender/groupId.
    // Bảy trường dưới KHÔNG nằm trong payload nào — chúng do luồng khác đặt.
    'Customer.latitude': 'do geocode địa chỉ đặt, không phải người dùng gõ',
    'Customer.longitude': 'do geocode địa chỉ đặt',
    'Customer.totalPurchases': 'số tổng hợp từ phiếu bán',
    'Customer.lastPurchaseDate': 'suy từ phiếu bán gần nhất',
    'Customer.tier': 'hạng khách do hệ thống xếp, form sửa không gửi',
    'Customer.salesUserId': 'gán ở luồng riêng; trang khách chỉ dùng để LỌC, không gửi khi lưu',
    'Customer.salesUserName': 'đi kèm salesUserId',
    // Cơ chế gộp mã / combo — do luồng gộp đặt, ProductForm không gửi (đo 21/08).
    'Product.bundleId': 'combo do luồng gộp mã đặt',
    'Product.mergedIntoId': 'gộp mã: KHÔNG đổi SKU kẻo gãy đẩy tồn (xem packaging-unit-architecture)',
    'Product.mergedRate': 'tỷ lệ quy đổi khi gộp mã',
}

/** Cột kỹ thuật, không phải dữ liệu người dùng. */
const BO_QUA = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'storeId', 'branchId'])

function docCotCsdl(sch: string, model: string): string[] | null {
    const dau = sch.indexOf(`model ${model} {`)
    if (dau < 0) return null
    const cuoi = sch.indexOf('\n}', dau)
    if (cuoi < 0) return null
    const ra: string[] = []
    for (const raw of sch.slice(dau, cuoi).split('\n').slice(1)) {
        const l = raw.trim()
        if (!l || l.startsWith('//') || l.startsWith('///') || l.startsWith('@@')) continue
        const p = l.split(/\s+/)
        const ten = p[0], kieu = p[1] || ''
        if (!ten || !/^[a-z]/.test(ten)) continue
        if (BO_QUA.has(ten)) continue
        // bỏ quan hệ: kiểu viết hoa đầu và KHÔNG phải kiểu vô hướng của Prisma
        const voHuong = /^(String|Int|Float|Boolean|DateTime|Decimal|BigInt|Json|Bytes)\b/.test(kieu)
        if (!voHuong) continue
        ra.push(ten)
    }
    return ra
}

function docKhoaZod(src: string, ten: string): string[] | null {
    const dau = src.indexOf(`export const ${ten} = z.object({`)
    if (dau < 0) return null
    const cuoi = src.indexOf('\n})', dau)
    if (cuoi < 0) return null
    return [...src.slice(dau, cuoi).matchAll(/^\s{4}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)].map(m => m[1]!)
}

console.log('Soát trường lạc — cột CSDL thiếu ở lớp zod (sửa xong không lưu)\n')

let sch: string, zod: string
try {
    sch = fs.readFileSync(path.join(GOC, 'prisma', 'schema-store.prisma'), 'utf8')
    zod = fs.readFileSync(path.join(GOC, 'src', 'schemas', 'index.ts'), 'utf8')
} catch (e: any) {
    console.error(`❌ KHÔNG đọc được schema hoặc zod: ${e?.message}`)
    console.error('   Không đọc được thì KHÔNG kết luận được — đừng báo xanh.')
    process.exit(2)
}

let soiDuoc = 0
const lac: Array<{ model: string; truong: string[] }> = []

for (const { model, schema } of CAP) {
    const cot = docCotCsdl(sch, model)
    const khoa = docKhoaZod(zod, schema)
    if (!cot) { console.error(`❌ không thấy model ${model} trong schema-store.prisma`); process.exit(2) }
    if (!khoa) { console.error(`❌ không thấy ${schema} trong src/schemas/index.ts`); process.exit(2) }
    soiDuoc++

    const thieu = cot.filter(c => !khoa.includes(c) && !KHONG_CHO_SUA[`${model}.${c}`])
    console.log(`   ${model.padEnd(12)} ${String(cot.length).padStart(2)} cột CSDL · ${String(khoa.length).padStart(2)} khoá zod`
        + (thieu.length ? `  ❌ thiếu ${thieu.length}` : '  ✅'))
    if (thieu.length) lac.push({ model, truong: thieu })
}

console.log(`\n   Đã soi ${soiDuoc}/${CAP.length} model · ${Object.keys(KHONG_CHO_SUA).length} trường khai không cho sửa.\n`)

if (!lac.length) {
    console.log('✅ Không trường nào lạc — mọi cột cho sửa đều có mặt trong zod.')
    process.exit(0)
}

console.log('❌ Trường có trong CSDL mà zod KHÔNG khai ⇒ người dùng sửa sẽ bị CẮT, trả 200 OK:\n')
for (const x of lac) {
    console.log(`   ${x.model}: ${x.truong.join(', ')}`)
}
console.log('\n   Cách sửa: thêm trường vào schema zod (src/schemas/index.ts),')
console.log('   HOẶC nếu cố ý không cho sửa tay thì khai vào KHONG_CHO_SUA của bộ soát này KÈM LÝ DO.')
process.exit(1)
