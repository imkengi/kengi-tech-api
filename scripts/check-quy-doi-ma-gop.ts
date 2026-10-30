/**
 * Kiểm NHẬP HÀNG VÀO MÃ ĐÃ GỘP — npx tsx scripts/check-quy-doi-ma-gop.ts
 *
 * Chủ shop 30/10/2026 (ảnh SP000197 −5, EDH-CBZ010-E2 "ĐÃ GỘP → SP000197" "1 quy đổi"): "đã gộp mà khi nhập
 * … không quy đổi". Đo thật: phiếu NH-20261030-105 cộng +1 vào mã gộp thay vì +5 cái SP000197; KENGISTORE
 * 7 dòng / 4 mã kẹt như vậy từ 10/08. Lõi: lib/quyDoiMaGop.ts — dùng ở routes/importReceipts.ts (lưu +
 * hoàn tất nháp), inventory.ts (/receipts), importData.ts (Excel), lib/hoaDonDauVao.ts (đọc HĐ đầu vào).
 * Sai ở đây là kho lệch đúng bằng hệ số (1 thay vì 5) hoặc tổng phiếu lệch tiền — nên mỗi thứ một ca.
 *
 * Phần 6–7 (chủ shop 30/10: "phải luôn có logic chứ"): lib/donTonMaGop.ts — nhịp 10 phút dời MỌI tồn kẹt ở
 * mã gộp sang mã đích (mọi đường: POS, kiểm kê, chuyển kho…), giá vốn theo cách tính của cửa hàng, KHÔNG
 * đụng mã KiotViet/MISA đang ghi tồn (dời là phình tồn mãi).
 */
import fs from 'fs'
import path from 'path'
import { giaiConTroGop, quyDoiDongMaGop, ghiChuQuyDoi, LoiQuyDoiMaGop } from '../src/lib/quyDoiMaGop'
import { khopSanPhamHoaDon, type ParsedInvoiceItem } from '../src/lib/hoaDonDauVao'
import { giaVonSauDon, donTonMaGop, sqlMaGopKet } from '../src/lib/donTonMaGop'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
async function nem(fn: () => Promise<any>): Promise<{ msg: string; loai: boolean }> {
    try { await fn(); return { msg: '', loai: false } } catch (e: any) { return { msg: String(e?.message || e), loai: e instanceof LoiQuyDoiMaGop } }
}

const SP = [
    { id: 'p197', sku: 'SP000197', name: 'Mũi khoan 10mm (cái)', baseUnit: 'Cái', mergedIntoId: null, mergedRate: 1 },
    // y như KENGISTORE: mã vỉ mang ĐVT "Cái" (gộp không đặt tên đơn vị chính)
    { id: 'pe2', sku: 'EDH-CBZ010-E2', name: 'Mũi khoan 10mm (vỉ)', baseUnit: 'Cái', mergedIntoId: 'p197', mergedRate: 5 },
    { id: 'a', sku: 'THUNG', name: 'Thùng', baseUnit: 'Thùng', mergedIntoId: 'b', mergedRate: 10 },
    { id: 'b', sku: 'HOP', name: 'Hộp', baseUnit: 'Hộp', mergedIntoId: 'c', mergedRate: 2 },
    { id: 'c', sku: 'CAI', name: 'Cái lẻ', baseUnit: 'Cái', mergedIntoId: null, mergedRate: 1 },
    { id: 'l', sku: 'LO', name: 'Lố', baseUnit: 'Lố', mergedIntoId: 'p197', mergedRate: 2.5 },
    { id: 'x', sku: 'X', name: 'X', baseUnit: 'Cái', mergedIntoId: 'y', mergedRate: 2 },
    { id: 'y', sku: 'Y', name: 'Y', baseUnit: 'Cái', mergedIntoId: 'x', mergedRate: 3 },
    { id: 'd', sku: 'DUT', name: 'Đứt', baseUnit: 'Cái', mergedIntoId: 'khong-co', mergedRate: 2 },
    { id: 'h', sku: 'HONG', name: 'Hỏng', baseUnit: 'Cái', mergedIntoId: 'p197', mergedRate: 0 },
]

/** prisma giả: Product (findMany theo id / findFirst theo tên hoặc SKU) + SkuMapping 'invoice' */
function spGia(anhXa: any[] = []) {
    const theoId = new Map(SP.map(p => [p.id, p]))
    const dem = { doc: 0 }
    const sp: any = {
        dem,
        product: {
            findMany: async ({ where }: any) => { dem.doc++; return (where?.id?.in || []).map((id: string) => theoId.get(id)).filter(Boolean).map((p: any) => ({ ...p })) },
            findFirst: async ({ where }: any) => {
                const ten = String(where?.OR?.[0]?.name?.equals || '').toLowerCase(), sku = where?.OR?.[1]?.sku
                const p = SP.find(x => x.name.toLowerCase() === ten || x.sku === sku)
                return p ? { ...p } : null
            },
        },
        skuMapping: {
            findFirst: async ({ where }: any) => {
                const m = anhXa.find(a => a.platform === where.platform && a.platformSku.toLowerCase() === String(where.platformSku.equals).toLowerCase())
                return m ? { ...m, product: { ...theoId.get(m.productId) } } : null
            },
        },
    }
    return sp
}

async function main() {
    console.log('\n1. Đổi dòng phiếu nhập (quyDoiDongMaGop)')
    {
        const sp = spGia()
        const thuong = [{ productId: 'p197', productSku: 'SP000197', productName: 'x', quantity: 3, costPrice: 25000, total: 75000 }]
        const r = await quyDoiDongMaGop(sp, thuong)
        ok('1a. Không dòng nào gộp → trả lại CHÍNH mảng đầu vào, daDoi rỗng', r.items === thuong && r.daDoi.length === 0)

        // Ca THẬT 30/10: NH-20261030-105 — 1 vỉ EDH-CBZ010-E2 giá 130.000 (tên dòng là tên trên HĐ)
        const that = await quyDoiDongMaGop(sp, [{ productId: 'pe2', productSku: 'EDH-CBZ010-E2', productName: 'DH-CBZ010-E2 Mũi khoan lệch tâm 10mm E', quantity: 1, costPrice: 130000, total: 130000 }])
        const d = that.items[0]
        ok('1b. Ca thật: 1 vỉ → 5 cái SP000197', d.productId === 'p197' && d.quantity === 5 && d.productSku === 'SP000197', d)
        ok('1c. Đơn giá ÷5 = 26.000, THÀNH TIỀN giữ 130.000', d.costPrice === 26000 && d.total === 130000, d)
        ok('1d. Tên snapshot theo mã đích (tồn kho thuế đối chiếu theo chuỗi)', d.productName === 'Mũi khoan 10mm (cái)', d.productName)
        ok('1e. daDoi ghi đủ để báo người dùng', JSON.stringify(that.daDoi) === JSON.stringify([{ tuSku: 'EDH-CBZ010-E2', sangSku: 'SP000197', heSo: 5, soLuong: 1, soLuongSau: 5 }]), that.daDoi)

        const khongTong = (await quyDoiDongMaGop(sp, [{ productId: 'pe2', quantity: 2, costPrice: 130000 } as any])).items[0]
        ok('1f. Không gửi total → CHỐT total = SL × giá cũ (260.000), không để SL×giá mới tự tính', khongTong.total === 260000 && khongTong.quantity === 10, khongTong)

        const giam = (await quyDoiDongMaGop(sp, [{ productId: 'pe2', quantity: 2, costPrice: 130000, total: 250000, discount: 10000 } as any])).items[0] as any
        ok('1g. Dòng có giảm giá: thành tiền 250.000 giữ nguyên, giảm giá không đổi', giam.total === 250000 && giam.discount === 10000 && giam.quantity === 10, giam)

        const le = await quyDoiDongMaGop(sp, [{ productId: 'pe2', quantity: 3, costPrice: 124820, total: 374460 }])
        ok('1h. Đơn giá chia ra số lẻ (124.820 ÷ 5) vẫn giữ tổng đúng từng đồng', le.items[0].total === 374460 && le.items[0].quantity === 15, le.items[0])

        const tron = [
            { productId: 'p197', quantity: 3, costPrice: 25000, total: 75000 },
            { productId: 'pe2', quantity: 1, costPrice: 130000, total: 130000 },
            { productId: 'c', quantity: 4, costPrice: 1000, total: 4000 },
        ]
        const rt = await quyDoiDongMaGop(sp, tron)
        ok('1i. Dòng trộn: chỉ dòng mã gộp đổi, dòng thường GIỮ NGUYÊN đối tượng, đúng thứ tự',
            rt.items[0] === tron[0] && rt.items[2] === tron[2] && rt.items[1].productId === 'p197' && rt.items[1].quantity === 5 && rt.items.length === 3)

        const hai = await quyDoiDongMaGop(sp, [{ productId: 'pe2', quantity: 1, costPrice: 1, total: 1 }, { productId: 'pe2', quantity: 2, costPrice: 1, total: 2 }])
        ok('1j. Hai dòng cùng mã gộp đều đổi (5 và 10)', hai.items[0].quantity === 5 && hai.items[1].quantity === 10 && hai.daDoi.length === 2)
        ok('1k. Không sửa tại chỗ mảng/dòng đầu vào', tron[1].productId === 'pe2' && tron[1].quantity === 1)
    }

    console.log('\n2. Gộp nhiều nấc + dữ liệu gộp hỏng')
    {
        const sp = spGia()
        const ch = await quyDoiDongMaGop(sp, [{ productId: 'a', quantity: 1, costPrice: 200000, total: 200000 }])
        ok('2a. Thùng → Hộp (×10) → Cái (×2): 1 thùng = 20 cái, giá 10.000', ch.items[0].productId === 'c' && ch.items[0].quantity === 20 && ch.items[0].costPrice === 10000, ch.items[0])
        ok('2b. daDoi nói mã GỐC → mã CUỐI', ch.daDoi[0]?.tuSku === 'THUNG' && ch.daDoi[0]?.sangSku === 'CAI' && ch.daDoi[0]?.heSo === 20, ch.daDoi)

        const sp2 = spGia()
        await giaiConTroGop(sp2, ['pe2', 'a'])
        ok('2c. Đọc theo lượt (mỗi nấc một câu), không hỏi từng mã', sp2.dem.doc <= 4, sp2.dem.doc)

        const lo1 = await nem(() => quyDoiDongMaGop(sp, [{ productId: 'l', quantity: 1, costPrice: 1, total: 1 }]))
        ok('2d. 1 × 2,5 = 2,5 → LỖI rõ (không làm tròn âm thầm)', lo1.loai && /không phải số nguyên/.test(lo1.msg) && /LO/.test(lo1.msg), lo1)
        const lo2 = await quyDoiDongMaGop(sp, [{ productId: 'l', quantity: 2, costPrice: 1, total: 2 }])
        ok('2e. 2 × 2,5 = 5 → đổi được', lo2.items[0].quantity === 5)

        const vong = await nem(() => quyDoiDongMaGop(sp, [{ productId: 'x', quantity: 1, costPrice: 1, total: 1 }]))
        ok('2f. Gộp vòng tròn X → Y → X → LỖI, không lặp vô tận', vong.loai && /vòng tròn/.test(vong.msg), vong)
        const dut = await nem(() => quyDoiDongMaGop(sp, [{ productId: 'd', quantity: 1, costPrice: 1, total: 1 }]))
        ok('2g. Mã đích không còn → LỖI', dut.loai && /không còn trong kho/.test(dut.msg), dut)
        const hs0 = await nem(() => quyDoiDongMaGop(sp, [{ productId: 'h', quantity: 1, costPrice: 1, total: 1 }]))
        ok('2h. Hệ số 0 → LỖI (không coi bừa là 1)', hs0.loai && /hệ số quy đổi không hợp lệ/.test(hs0.msg), hs0)
        const rong = await quyDoiDongMaGop(sp, undefined as any)
        ok('2i. items thiếu → mảng rỗng, không văng', Array.isArray(rong.items) && rong.items.length === 0)
    }

    console.log('\n3. Ghi chú thẻ kho')
    ok('3a. Một dòng đổi vào mã đích → ghi rõ', ghiChuQuyDoi([{ tuSku: 'EDH-CBZ010-E2', sangSku: 'SP000197', heSo: 5, soLuong: 1, soLuongSau: 5 }], 'SP000197') === ' — quy đổi 1 EDH-CBZ010-E2 × 5')
    ok('3b. Hai dòng đổi vào CÙNG mã đích → không ghi (không đoán dòng nào)', ghiChuQuyDoi([
        { tuSku: 'A', sangSku: 'SP000197', heSo: 5, soLuong: 1, soLuongSau: 5 }, { tuSku: 'B', sangSku: 'SP000197', heSo: 2, soLuong: 1, soLuongSau: 2 }], 'SP000197') === '')
    ok('3c. Mã thường → không ghi', ghiChuQuyDoi([], 'SP000197') === '')

    console.log('\n4. Đọc hoá đơn đầu vào (khopSanPhamHoaDon)')
    {
        const dong = (o: Partial<ParsedInvoiceItem>): ParsedInvoiceItem => ({ name: '', unit: 'Vỉ', quantity: 1, unitPrice: 130000, amount: 130000, ...o })
        const theoTen = [dong({ name: 'Mũi khoan 10mm (vỉ)' })]
        await khopSanPhamHoaDon(spGia(), theoTen)
        const t = theoTen[0]
        ok('4a. Khớp TÊN vào mã gộp → form hiện luôn SP000197 × 5, giá 26.000', t.productId === 'p197' && t.productSku === 'SP000197' && t.quantity === 5 && t.unitPrice === 26000 && t.matched === true, t)
        ok('4b. Ghi hệ số đã đổi + ĐVT kho', t.convertedBy === 5 && t.unit === 'Cái', t)

        // Ca THẬT: chủ shop bấm Liên kết dòng "DH-CBZ010-E2 …" vào MÃ GỘP (SkuMapping 'invoice', hệ số 1)
        const anhXa = [{ platform: 'invoice', platformSku: 'DH-CBZ010-E2 Mũi khoan lệch tâm 10mm E', productId: 'pe2', conversionRate: 1 }]
        const theoLienKet = [dong({ name: 'DH-CBZ010-E2 Mũi khoan lệch tâm 10mm E' })]
        await khopSanPhamHoaDon(spGia(anhXa), theoLienKet)
        ok('4c. Ca thật: liên kết đã nhớ trỏ mã gộp → SP000197 × 5', theoLienKet[0].productId === 'p197' && theoLienKet[0].quantity === 5 && theoLienKet[0].convertedBy === 5, theoLienKet[0])

        const heSoKep = [dong({ name: 'Hộp 2 vỉ' })]
        await khopSanPhamHoaDon(spGia([{ platform: 'invoice', platformSku: 'Hộp 2 vỉ', productId: 'pe2', conversionRate: 2 }]), heSoKep)
        ok('4d. Liên kết ×2 vào mã gộp ×5 → 1 hộp = 10 cái, hệ số nhân dồn 10', heSoKep[0].quantity === 10 && heSoKep[0].convertedBy === 10 && heSoKep[0].productId === 'p197', heSoKep[0])

        const thuong = [dong({ name: 'Mũi khoan 10mm (cái)', unit: 'Cái', quantity: 3, unitPrice: 26000, amount: 78000 })]
        await khopSanPhamHoaDon(spGia(), thuong)
        ok('4e. Mã thường: giữ nguyên SL/giá, không gắn hệ số', thuong[0].productId === 'p197' && thuong[0].quantity === 3 && thuong[0].convertedBy === undefined, thuong[0])

        const le = [dong({ name: 'Lố' })]
        await khopSanPhamHoaDon(spGia(), le)
        ok('4f. Đổi ra số lẻ (1 × 2,5) → ĐỂ NGUYÊN dòng, không văng — lưu phiếu mới báo', le[0].productId === 'l' && le[0].quantity === 1, le[0])
    }

    console.log('\n5. Các đường nhập kho đều đi qua quy đổi (soát mã nguồn)')
    {
        const goc = path.join(__dirname, '..', 'src')
        const doc = (f: string) => fs.readFileSync(path.join(goc, f), 'utf8')
        const ir = doc('routes/importReceipts.ts')
        const thanTao = (/router\.post\('\/', authMiddleware[\s\S]*?\n\}\)/.exec(ir) || [''])[0]
        ok('5a. POST /import-receipts đổi dòng TRƯỚC khi tính tiền', /quyDoiDongMaGop\(prisma, dongGui\)/.test(thanTao) && thanTao.indexOf('quyDoiDongMaGop') < thanTao.indexOf('const totalCost'))
        const thanHoanTat = (/router\.put\('\/:id\/complete'[\s\S]*?\n\}\)/.exec(ir) || [''])[0]
        ok('5b. Hoàn tất nháp: đổi dòng + SỬA dòng phiếu + cộng tồn theo dòng đã đổi',
            /quyDoiDongMaGop\(prisma, receipt\.items\)/.test(thanHoanTat) && /importReceiptItem\.update/.test(thanHoanTat) && /for \(const item of dongs\)/.test(thanHoanTat) && !/for \(const item of receipt\.items\)/.test(thanHoanTat))
        ok('5c. Hoàn tất nháp hỏng quy đổi → trả phiếu về NHÁP (không kẹt "processing")', /status: 'processing' \}, data: \{ status: 'draft' \}/.test(thanHoanTat))
        ok('5d. /inventory/receipts đổi dòng trước khi lập phiếu', /quyDoiDongMaGop\(prisma, dongGui\)/.test(doc('routes/inventory.ts')))
        ok('5e. Nhập phiếu từ Excel đổi dòng trước khi lập phiếu', /quyDoiDongMaGop\(getPrisma\(req\), itemsData\)/.test(doc('routes/importData.ts')))
        const pr = doc('routes/products.ts')
        ok('5f. Danh sách SP: tồn CHI NHÁNH của mã gộp quy đổi từ mã đích (hết "1 quy đổi" sai)', /tonChiNhanhMaGop\(p\)/.test(pr))
    }

    console.log('\n6. Giá vốn mã đích khi dời tồn (giaVonSauDon) — y như một lần nhập')
    {
        const g = (cach: string, o: any) => giaVonSauDon(cach, { tonDich: 10, giaDich: 20000, slDoi: 10, giaNguon: 210000, heSo: 10, nguonMoiHon: true, ...o })
        ok('6a. Cố định (fixed) → giữ nguyên', g('fixed', {}) === null)
        ok('6b. Bình quân: 10 @20.000 + 10 @21.000 → 20.500', g('average', {}) === 20500, g('average', {}))
        ok('6c. Bình quân, mã đích ÂM −22 nhận 70 cùng giá 19.829 → vẫn 19.829',
            g('average', { tonDich: -22, giaDich: 19829, slDoi: 70, giaNguon: 198290 }) === 19829, g('average', { tonDich: -22, giaDich: 19829, slDoi: 70, giaNguon: 198290 }))
        ok('6d. Bình quân mà dời xong vẫn ≤ 0 (−44 + 20) → giữ giá cũ', g('average', { tonDich: -44, giaDich: 14852, slDoi: 20, giaNguon: 148520 }) === 14852)
        ok('6e. Giá nhập cuối: lần nhập vào mã gộp MỚI HƠN → lấy giá đó ÷ hệ số', g('lastImport', {}) === 21000)
        ok('6f. Giá nhập cuối: mã đích có lần nhập mới hơn → giữ nguyên', g('lastImport', { nguonMoiHon: false }) === null)
        ok('6g. Dời tồn ÂM (bán nhầm trên mã gộp) → không đổi giá vốn', g('average', { slDoi: -5 }) === null)
        ok('6h. Mã gộp giá vốn 0 → không kéo giá mã đích về 0', g('average', { giaNguon: 0 }) === null)
    }

    console.log('\n7. Dọn tồn kẹt (donTonMaGop) — phép gộp thay bằng bản giả')
    {
        // Cửa hàng giả: tồn/giá sống để bản gộp giả cập nhật khi "chạy thật"
        const ton: Record<string, { stock: number; costPrice: number }> = {
            p197: { stock: -5, costPrice: 24964 }, c: { stock: 10, costPrice: 1000 },
        }
        const ungVien = [
            { id: 'pe2', sku: 'EDH-CBZ010-E2', stock: 1, costPrice: 124820, dongBoNgoai: false },
            { id: 'kv', sku: 'KV-VI', stock: 3, costPrice: 50000, dongBoNgoai: true },
            { id: 'l', sku: 'LO', stock: 1, costPrice: 10, dongBoNgoai: false },
            { id: 'x', sku: 'X', stock: 2, costPrice: 10, dongBoNgoai: false },
            { id: 'a', sku: 'THUNG', stock: 1, costPrice: 30000, dongBoNgoai: false },
        ]
        const base = spGia()
        const sp: any = {
            ...base,
            product: {
                ...base.product,
                findUnique: async ({ where }: any) => ton[where.id] ? { ...ton[where.id] } : null,
            },
            storeSettings: { findFirst: async () => ({ costPriceMethod: 'average' }) },
            $queryRawUnsafe: async (sql: string) => {
                if (/"mergedIntoId" IS NOT NULL/.test(sql)) return ungVien.map(u => ({ ...u }))
                if (/MAX\("createdAt"\)/.test(sql)) return []
                return []
            },
        }
        const goi: any[] = []
        const gopGia: any = async (_sp: any, o: any) => {
            goi.push({ fromSku: o.fromSku, toSku: o.toSku, rate: o.rate, dryRun: o.dryRun, force: o.force, giuLienKetSan: o.giuLienKetSan, coGiaVon: typeof o.tinhGiaVonDich === 'function' })
            const dichId = SP.find(p => p.sku === o.toSku)!.id
            const nguon = ungVien.find(u => u.sku === o.fromSku)!
            if (!o.dryRun) {
                const t = ton[dichId]
                const slDoi = Math.round(nguon.stock * o.rate)
                const gm = o.tinhGiaVonDich({ tonDich: t.stock, giaDich: t.costPrice, slDoi, giaNguon: nguon.costPrice })
                t.stock += slDoi
                if (gm != null) t.costPrice = gm
            }
            return { rowsByTable: { ImportReceiptItem: 1, InventoryTransaction: 1 } }
        }

        const thu = await donTonMaGop(sp, { chayThat: false, gop: gopGia })
        const theo = (ds: any[], sku: string) => ds.find(k => k.tuSku === sku)
        ok('7a. Chạy thử: mọi lần gộp đều dryRun, tồn mã đích CHƯA đổi', goi.every(c => c.dryRun === true) && ton.p197.stock === -5, goi)
        ok('7b. Ca thật: 1 vỉ EDH-CBZ010-E2 → +5 SP000197 (−5 → 0), dự kiến', theo(thu, 'EDH-CBZ010-E2')?.ketQua === 'se_don' && theo(thu, 'EDH-CBZ010-E2')?.slDoi === 5 && theo(thu, 'EDH-CBZ010-E2')?.tonDichSau === 0, theo(thu, 'EDH-CBZ010-E2'))
        ok('7c. Mã KiotViet/MISA đang ghi tồn → BỎ QUA, không gọi gộp', theo(thu, 'KV-VI')?.ketQua === 'bo_qua' && /KiotViet\/MISA/.test(theo(thu, 'KV-VI')?.lyDo || '') && !goi.some(c => c.fromSku === 'KV-VI'))
        ok('7d. 1 × 2,5 lẻ → BỎ QUA, không làm tròn', theo(thu, 'LO')?.ketQua === 'bo_qua' && /không phải số nguyên/.test(theo(thu, 'LO')?.lyDo || ''))
        ok('7e. Gộp vòng tròn → BỎ QUA mã đó, mã khác vẫn chạy', theo(thu, 'X')?.ketQua === 'bo_qua' && /vòng tròn/.test(theo(thu, 'X')?.lyDo || '') && theo(thu, 'THUNG')?.ketQua === 'se_don')
        ok('7f. Gộp nhiều nấc: dời THẲNG về mã cuối (CAI ×20)', goi.some(c => c.fromSku === 'THUNG' && c.toSku === 'CAI' && c.rate === 20))
        ok('7g. Luôn force (chiều gộp chủ shop đã chốt) + có hàm tính giá vốn', goi.every(c => c.force === true && c.coGiaVon))
        ok('7g2. KHÔNG dời liên kết listing sàn (listing vỉ trỏ mã gộp là đúng — đẩy tồn chia hệ số)', goi.every(c => c.giuLienKetSan === true))

        goi.length = 0
        const that = await donTonMaGop(sp, { chayThat: true, gop: gopGia })
        ok('7h. Chạy thật: gộp KHÔNG dryRun, ghi "da_don"', goi.length === 2 && goi.every(c => c.dryRun === false) && theo(that, 'EDH-CBZ010-E2')?.ketQua === 'da_don', goi)
        ok('7i. Chạy thật: SP000197 −5 → 0 (đọc lại sau khi gộp)', ton.p197.stock === 0 && theo(that, 'EDH-CBZ010-E2')?.tonDichSau === 0)
        ok('7j. Giá vốn bình quân mã đích: 10 @1.000 + 20 @1.500 → 1.333', ton.c.costPrice === 1333 && theo(that, 'THUNG')?.giaDichSau === 1333, ton.c)
        ok('7k. Không còn mã kẹt → trả rỗng, không đọc cài đặt', (await donTonMaGop({ $queryRawUnsafe: async () => [] }, { chayThat: true, gop: gopGia })).length === 0)
        goi.length = 0
        const quaGio = await donTonMaGop(sp, { chayThat: false, gop: gopGia, hetHanLuc: Date.now() - 1 })
        ok('7l. Hết ngân sách thời gian: vẫn làm ĐÚNG MỘT mã rồi dừng (không đói, không tràn tick)', goi.length === 1 && quaGio.filter(k => k.ketQua === 'se_don').length === 1, goi)
    }

    console.log('\n8. Nối dây + an toàn (soát mã nguồn)')
    {
        const goc = path.join(__dirname, '..', 'src')
        const doc = (f: string) => fs.readFileSync(path.join(goc, f), 'utf8')
        const mp = doc('lib/mergeProduct.ts')
        ok('8a. Phép gộp KHOÁ hai dòng sản phẩm (FOR UPDATE) rồi đọc lại tồn trong giao dịch', /FOR UPDATE/.test(mp) && /SET stock = stock \+ \$1 WHERE id = \$2`, slDoi, dst\.id/.test(mp) && !/Math\.round\(\(src\.stock \|\| 0\) \* rate\)/.test(mp))
        ok('8b. Phép gộp nhân hệ số cả "số đã trả" (returnedQuantity)', /"returnedQuantity" = "returnedQuantity" \* \$\{rate\}/.test(mp))
        ok('8b2. Phép gộp chỉ dời link listing sàn khi KHÔNG yêu cầu giữ', /onlineProductLinks > 0 && !opts\.giuLienKetSan/.test(mp))
        const ct = doc('routes/cronTick.ts')
        ok('8c. Nhịp nền gọi nhipDonTonMaGop mỗi 10 phút', /% 10 === 8\)[\s\S]{0,200}nhipDonTonMaGop/.test(ct))
        const dem = sqlMaGopKet('branch_abc', true)
        ok('8d. Câu dò nhanh ghi rõ schema + loại mã KiotViet/MISA', /"branch_abc"\."Product"/.test(dem) && /NOT EXISTS/.test(dem) && /'kiotviet','misa'/.test(dem))
        let nem2 = ''
        try { sqlMaGopKet('x"; DROP TABLE y; --', true) } catch (e: any) { nem2 = String(e?.message) }
        ok('8e. Tên schema lạ → từ chối (không nối chuỗi bừa vào SQL)', /schema lạ/.test(nem2))
        const dt = doc('lib/donTonMaGop.ts')
        const thanNhip = (/export async function nhipDonTonMaGop[\s\S]*?\n\}/.exec(dt) || [''])[0]
        ok('8g. Nhịp có ngân sách thời gian, truyền hạn xuống từng cửa hàng',
            /nhipDonTonMaGop\(nganSachMs = 15_000\)/.test(dt) && /donTonMaGop\(getStorePrisma\(schema\), \{ chayThat: true, hetHanLuc \}\)/.test(dt))
        ok('8f. Nhịp dò bằng registry TRƯỚC, chỉ mở client cửa hàng khi có mã kẹt',
            thanNhip.indexOf('registryPrisma as any).$queryRawUnsafe') > 0 && thanNhip.indexOf('registryPrisma as any).$queryRawUnsafe') < thanNhip.indexOf('getStorePrisma(schema)'))
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
