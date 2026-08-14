/**
 * Kiểm chứng TRUY VẾT TỒN KHO.
 *
 * Chạy:  npx tsx scripts/check-stock-trace.ts
 *
 * Công cụ này chỉ đích danh một chứng từ và nói "chỗ này làm tồn đi âm". Chỉ
 * nhầm thì người dùng đi tra một phiếu vô can, mất công và mất tin.
 *
 * Chỗ nguy hiểm nhất KHÔNG phải phép cộng dồn, mà là im lặng khi sổ chuyển động
 * không dựng lại được tồn hiện tại — lúc đó cả dòng thời gian lệch đi một khoảng
 * cố định, và mốc "bắt đầu âm" chỉ vào sai chỗ.
 */

import { truyVetTonKho } from '../src/lib/stockTrace'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const B = (type: string, quantity: number, ngay: string, them: any = {}) => ({
    type, quantity, reason: them.reason ?? '', note: null,
    referenceId: them.ref ?? null, referenceType: them.refType ?? null,
    userName: them.ai ?? 'Nhân viên A',
    transactionDate: new Date(`${ngay}T10:00:00+07:00`),
    createdAt: new Date(`${ngay}T10:00:00+07:00`),
})

function fake(buoc: any[], ton: number, loi?: { sp?: boolean; so?: boolean }) {
    return {
        product: {
            findUnique: async () => {
                if (loi?.sp) throw new Error('relation "Product" does not exist')
                return { id: 'P1', name: 'Nồi chiên', sku: 'NC01', stock: ton }
            },
        },
        inventoryTransaction: {
            findMany: async ({ take }: any) => {
                if (loi?.so) throw new Error('relation "InventoryTransaction" does not exist')
                return buoc.slice(0, take)
            },
        },
    }
}

async function main() {
    console.log('\n▶ Dựng đúng dòng thời gian và chỉ đúng bước đi âm\n')

    /* Nhập 10 → bán 4 → bán 8 (âm 2) → nhập 5. Bước thứ ba là bước đầu tiên âm. */
    const r = await truyVetTonKho(fake([
        B('import', 10, '2026-08-01', { ref: 'NH-001', refType: 'import' }),
        B('export', 4, '2026-08-02', { ref: 'HD-001', refType: 'sale' }),
        B('export', 8, '2026-08-03', { ref: 'HD-002', refType: 'sale' }),
        B('import', 5, '2026-08-04', { ref: 'NH-002', refType: 'import' }),
    ], 3), 'P1')

    ok('cộng dồn ra đúng tồn cuối (10-4-8+5 = 3)', r.tonTheoSo === 3, r.tonTheoSo)
    ok('khớp với tồn hiện tại', r.khopSo === true, { lech: r.lech })
    ok('chỉ đúng bước đầu tiên đi âm', r.buocDauTienAm?.chungTu === 'sale HD-002', r.buocDauTienAm)
    ok('… và tồn tại bước đó là -2', r.buocDauTienAm?.conLai === -2, r.buocDauTienAm?.conLai)
    ok('nhập làm TĂNG, xuất làm GIẢM', r.buoc[0].thayDoi === 10 && r.buoc[1].thayDoi === -4,
        r.buoc.slice(0, 2).map(b => b.thayDoi))
    ok('chỉ MỘT bước được đánh dấu bắt đầu âm', r.buoc.filter(b => b.batDauAm).length === 1)
    ok('bước sau đó KHÔNG bị đánh dấu lại dù vẫn còn âm',
        r.buoc[3].batDauAm === false, r.buoc[3])

    console.log('\n▶ Trả hàng làm tăng tồn, điều chỉnh theo dấu của chính nó\n')

    const r2 = await truyVetTonKho(fake([
        B('export', 5, '2026-08-01'),
        B('return', 2, '2026-08-02'),
        B('adjustment', -3, '2026-08-03'),
    ], -6), 'P1')
    ok('trả hàng cộng vào tồn', r2.buoc[1].thayDoi === 2, r2.buoc[1].thayDoi)
    ok('điều chỉnh âm giữ nguyên dấu âm', r2.buoc[2].thayDoi === -3, r2.buoc[2].thayDoi)
    ok('tổng ra -6', r2.tonTheoSo === -6, r2.tonTheoSo)
    ok('bước đầu tiên âm là lần xuất đầu tiên', r2.buocDauTienAm?.conLai === -5, r2.buocDauTienAm)

    console.log('\n▶ Sổ KHÔNG dựng lại được tồn hiện tại — phải nói ra\n')

    /* Đây là chỗ dễ đánh lừa nhất: dòng thời gian trông đầy đủ nhưng lệch một
     * khoảng cố định vì tồn đầu kỳ đặt thẳng lúc khởi tạo, không có bản ghi. */
    const r3 = await truyVetTonKho(fake([
        B('export', 5, '2026-08-01'),
    ], 95), 'P1')
    ok('phát hiện sổ không khớp tồn', r3.khopSo === false, { tonTheoSo: r3.tonTheoSo, lech: r3.lech })
    ok('… nêu đúng độ chênh', r3.lech === 100, r3.lech)
    ok('… nói rõ phần chênh KHÔNG có trong sổ',
        r3.ghiChu.some(g => /KHÔNG có trong sổ chuyển động/.test(g)), r3.ghiChu)
    ok('… và cảnh báo mốc "bắt đầu âm" có thể lệch',
        r3.ghiChu.some(g => /có thể lệch/.test(g)), r3.ghiChu)

    console.log('\n▶ Không có bản ghi nào — nói thẳng là không truy vết được\n')

    const r4 = await truyVetTonKho(fake([], -12), 'P1')
    ok('không có bước nào → không bịa mốc âm', r4.buocDauTienAm === null)
    ok('… nói rõ tồn được đặt trực tiếp, không truy vết được bằng sổ',
        r4.ghiChu.some(g => /không truy vết được bằng sổ/.test(g)), r4.ghiChu)

    console.log('\n▶ Đọc hỏng — không sập, không bịa\n')

    const r5 = await truyVetTonKho(fake([B('export', 5, '2026-08-01')], 10, { so: true }), 'P1')
    ok('hỏng sổ chuyển động → không sập', !!r5)
    ok('… ghi vào mục thiếu', r5.thieu.some(t => /InventoryTransaction/.test(t)), r5.thieu)
    ok('… và KHÔNG chỉ đích danh chứng từ nào', r5.buocDauTienAm === null, r5.buocDauTienAm)

    const r6 = await truyVetTonKho(fake([B('export', 5, '2026-08-01')], 10, { sp: true }), 'P1')
    ok('hỏng bảng hàng hoá → vẫn dựng được dòng thời gian', r6.soBuoc === 1, r6.soBuoc)
    ok('… nhưng không khẳng định lệch khi chưa biết tồn thật',
        r6.sanPham === null, r6.sanPham)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
