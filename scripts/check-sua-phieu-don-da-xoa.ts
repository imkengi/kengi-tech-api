/**
 * Kiểm SỬA PHIẾU BÁN CỦA ĐƠN SÀN ĐÃ XOÁ — npx tsx scripts/check-sua-phieu-don-da-xoa.ts
 *
 * Đây là đường GHI vào sổ thật (huỷ phiếu, cộng kho, đảo bút toán) cho ~900 phiếu.
 * Sai một chiều là kho cộng hai lần hoặc huỷ nhầm phiếu bán thật. Nên bộ này canh:
 *   - chạy thử KHÔNG ghi gì;
 *   - chỉ nhóm huỷ / giao thất bại / hoàn tiền mới bị huỷ phiếu; chỉ hoàn tiền CÓ phiếu trả mới cộng kho;
 *   - cộng kho đúng phần còn âm của thẻ kho, chạy LẠI không cộng thêm, không đảo bút toán thêm;
 *   - kỳ đã khoá sổ, phiếu đã huỷ, đơn gốc có lại ⇒ bỏ qua; đọc khoá sổ hỏng ⇒ DỪNG;
 *   - không có câu nào ghi vào EInvoice.
 */
import { quyetDinh, dongKhoCanCong, butToanDao } from '../src/lib/suaPhieuDonDaXoa'
import { SQL_PHIEU_CHUA_LAY_PHI, SQL_SO_KHO, SQL_BUT_TOAN, SQL_PHIEU_TRA } from '../src/lib/phanLoaiDonChuaLayPhi'
import { suaPhieuDonDaXoa, LY_DO_KHO } from '../src/services/suaPhieuDonDaXoa'
import type { CongSan, GianSan } from '../src/services/phanLoaiDonChuaLayPhi'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const qd = (x: any) => quyetDinh({ coPhieuTraDaDuyet: false, trangThaiPhieu: 'completed', ngayPhieu: '2026-08-20', ngayKhoaSo: null, donGocConTrongBang: false, ...x }).hanhDong

/** Sổ giả của một cửa hàng: phiếu, thẻ kho, bút toán — ghi lại MỌI lần ghi. */
function soGia(opts: { khoaSo?: string | null; khoaSoHong?: boolean } = {}) {
    const don = ['A', 'B', 'C', 'D', 'E', 'F', 'G']   // SPE-A … SPE-G
    const phieu = new Map(don.map(m => [`ONLINE-SPE-${m}`, { id: `t${m}`, receiptNumber: `ONLINE-SPE-${m}`, status: m === 'F' ? 'voided' : 'completed', total: 100000, transactionDate: new Date('2026-08-20T03:00:00Z'), createdAt: new Date('2026-08-20T03:00:00Z'), vatStatus: m === 'B' ? 'issued' : 'none', coSoHoaDon: m === 'B' }]))
    const the = [  // thẻ kho: mỗi đơn trừ 2 cái hàng p1; C trừ thêm 1 cái hàng p2 đã GỘP
        ...don.map(m => ({ referenceId: `ONLINE-SPE-${m}`, productId: 'p1', quantity: -2, productName: 'Mũi vít', productSku: 'MV' })),
        { referenceId: 'ONLINE-SPE-C', productId: 'p2', quantity: -1, productName: 'Cũ', productSku: 'CU' },
    ]
    const butToan = new Map<string, any>([
        ['SALE-ONLINE-SPE-A', { reference: 'SALE-ONLINE-SPE-A', debitAccount: '131-SHOPEE', debitAccountName: 'Phải thu Shopee', creditAccount: '511', creditAccountName: 'Doanh thu', amount: 100000, referenceType: 'online', branchId: null }],
        ['COGS-ONLINE-SPE-A', { reference: 'COGS-ONLINE-SPE-A', debitAccount: '632', debitAccountName: 'Giá vốn', creditAccount: '156', creditAccountName: 'Hàng hoá', amount: 60000, referenceType: 'online', branchId: null }],
    ])
    const ghi = { update: [] as string[], kho: [] as any[], chinhKho: [] as any[], butToan: [] as string[], einvoice: 0 }
    const chungDoc = async (sql: string, ...p: any[]): Promise<any> => {
        if (/"EInvoice"/.test(sql) && !/^\s*SELECT/i.test(sql)) ghi.einvoice++
        if (sql === SQL_PHIEU_CHUA_LAY_PHI) return [...phieu.values()].map(t => ({ ...t, orderNumber: t.receiptNumber.slice(7), platform: 'shopee', tong: phieu.size }))
        if (sql === SQL_SO_KHO) return (p[0] as string[]).map(ref => {
            const ds = the.filter(x => x.referenceId === ref); const rong = ds.reduce((s, x) => s + x.quantity, 0)
            return { ref, rong, da_tru: ds.filter(x => x.quantity < 0).reduce((s, x) => s + x.quantity, 0), da_hoan: ds.filter(x => x.quantity > 0).reduce((s, x) => s + x.quantity, 0) }
        })
        if (sql === SQL_BUT_TOAN) return (p[0] as string[]).filter(r => butToan.has(r)).map(reference => ({ reference }))
        if (sql === SQL_PHIEU_TRA) return (p[0] as string[]).includes('C') ? [{ code: 'RTN-SH-1', status: 'approved', originalInvoice: 'C', refundAmount: 0 }]
            : (p[0] as string[]).includes('D') ? [{ code: 'RTN-SH-2', status: 'rejected', originalInvoice: 'D', refundAmount: 0 }] : []
        if (/FROM "Transaction" WHERE "receiptNumber" = ANY/.test(sql)) return (p[0] as string[]).map(r => phieu.get(r)).filter(Boolean)
        if (/FROM "OnlineOrder" WHERE "orderNumber" = ANY/.test(sql)) return (p[0] as string[]).includes('SPE-G') ? [{ orderNumber: 'SPE-G' }] : []
        if (/FROM "OnlineOrder" WHERE "orderNumber" = \$1/.test(sql)) return p[0] === 'SPE-G' ? [{ '?column?': 1 }] : []
        if (/FROM "InventoryTransaction" it LEFT JOIN "Product"/.test(sql)) {
            const ra = new Map<string, any>()
            for (const x of the.filter(x => (p[0] as string[]).includes(x.referenceId))) {
                const k = `${x.referenceId}|${x.productId}`
                const o = ra.get(k) || { ref: x.referenceId, productId: x.productId, rong: 0, tonTai: true, gopVao: x.productId === 'p2' ? 'p9' : null }
                o.rong += x.quantity; ra.set(k, o)
            }
            return [...ra.values()]
        }
        if (/FROM "JournalEntry" WHERE reference = ANY/.test(sql)) return (p[0] as string[]).filter(r => butToan.has(r)).map(r => butToan.get(r))
        if (/FROM "EInvoice"/.test(sql)) return [{ transactionId: 'tB', invoiceSymbol: '1C26TAA', invoiceNumber: '00000123', invoiceDate: '2026-08-21', status: 'SENT', invoiceType: 'SALE', totalAmount: 100000, buyerName: 'Khách', buyerTaxCode: null, lookupCode: 'X', provider: 'vnpt' }]
        if (/SUM\(quantity\), 0\)::float8 AS rong, MIN\("productName"\)/.test(sql)) {
            const ds = the.filter(x => x.referenceId === p[0] && x.productId === p[1])
            return [{ rong: ds.reduce((s, x) => s + x.quantity, 0), ten: ds[0]?.productName, sku: ds[0]?.productSku }]
        }
        throw new Error('câu đọc lạ: ' + sql.replace(/\s+/g, ' ').slice(0, 80))
    }
    const tx = {
        $queryRawUnsafe: chungDoc,
        inventoryTransaction: { async create({ data }: any) { the.push(data); ghi.kho.push(data) } },
    }
    const sp = {
        $queryRawUnsafe: chungDoc,
        async $executeRawUnsafe(sql: string, ...p: any[]) {
            if (/"EInvoice"/.test(sql)) ghi.einvoice++
            if (!/^\s*UPDATE "Transaction" SET status = 'voided'/.test(sql)) throw new Error('câu ghi lạ: ' + sql.slice(0, 60))
            const t = [...phieu.values()].find(x => x.id === p[0])!
            if (['voided', 'returned'].includes(t.status)) return 0
            t.status = 'voided'; ghi.update.push(t.id); return 1
        },
        async $transaction(fn: any) { return fn(tx) },
        journalEntry: { async create({ data }: any) { if (butToan.has(data.reference)) { const e: any = new Error('trùng'); e.code = 'P2002'; throw e } butToan.set(data.reference, data); ghi.butToan.push(data.reference) } },
        periodLock: { async findFirst() { if (opts.khoaSoHong) throw new Error('mất kết nối'); return opts.khoaSo ? { lockDate: opts.khoaSo } : null } },
        onlineChannel: { async findMany() { return [{ id: 'store', name: 'Kengi Store', platform: 'shopee', accessToken: 'x' }] as GianSan[] } },
        onlineOrder: { async groupBy() { return [{ channelId: 'store', _count: { _all: 10 } }] } },
    }
    const chinhKho = async (_c: any, productId: string, _b: any, delta: number) => { ghi.chinhKho.push({ productId, delta }) }
    const taoCong = (): CongSan => ({
        async escrowShopee(sn) {
            return { saiGian: false, du: { thucNhan: sn === 'E' ? 143150 : 0, giaBan: 0, hoanChoKhach: ['C', 'D'].includes(sn) ? -100000 : 0 } }
        },
        async vanDonShopee(sn) { return sn === 'B' ? 'LOGISTICS_DELIVERY_FAILED' : 'LOGISTICS_DELIVERY_DONE' },
        async chiTiet(ma) { return new Map(ma.map(m => [m, { trangThai: ['A', 'F', 'G'].includes(m) ? 'CANCELLED' : 'COMPLETED' }])) },
        async quyetToanTikTok() { return { soGiaoDich: 0, thucNhan: null } },
    })
    return { sp, ghi, the, phieu, chinhKho, taoCong }
}

async function main() {
    console.log('\n▶ Sửa phiếu bán của đơn sàn đã xoá (phương án A)\n')

    /* 1 — luật quyết định */
    ok('1a. huỷ / giao thất bại → huỷ phiếu + cộng kho', qd({ loai: 'huy' }) === 'huy-phieu-cong-kho' && qd({ loai: 'giao-that-bai' }) === 'huy-phieu-cong-kho')
    ok('1b. hoàn tiền CÓ phiếu trả đã duyệt → cộng kho', qd({ loai: 'hoan-tien', coPhieuTraDaDuyet: true }) === 'huy-phieu-cong-kho')
    ok('1c. hoàn tiền KHÔNG phiếu trả → chỉ huỷ phiếu, KHÔNG cộng kho', qd({ loai: 'hoan-tien' }) === 'huy-phieu')
    ok('1d. nhóm khác / thất lạc / quyết toán âm / lỗi hỏi sàn / không tìm thấy → KHÔNG đụng',
        ['khac', 'that-lac', 'quyet-toan-am', 'loi-hoi-san', 'khong-tim-thay', 'chua-quyet-toan'].every(l => qd({ loai: l }) === 'bo-qua'))
    ok('1e. phiếu đã huỷ/đã trả → bỏ qua', qd({ loai: 'huy', trangThaiPhieu: 'voided' }) === 'bo-qua' && qd({ loai: 'huy', trangThaiPhieu: 'returned' }) === 'bo-qua')
    ok('1f. phiếu trong kỳ đã khoá sổ → bỏ qua; ngày sau khoá → làm',
        qd({ loai: 'huy', ngayKhoaSo: '2026-08-31' }) === 'bo-qua' && qd({ loai: 'huy', ngayKhoaSo: '2026-08-19' }) === 'huy-phieu-cong-kho')
    ok('1g. đơn gốc có lại trong bảng → bỏ qua (đường đảo thường lo), xét TRƯỚC mọi luật', qd({ loai: 'huy', donGocConTrongBang: true }) === 'bo-qua')

    /* 2 — dòng kho + bút toán đảo */
    const k = dongKhoCanCong([
        { productId: 'p1', rong: -2, tonTai: true, gopVao: null }, { productId: 'p3', rong: 0, tonTai: true, gopVao: null },
        { productId: 'p4', rong: 1, tonTai: true, gopVao: null }, { productId: 'p5', rong: -1, tonTai: false, gopVao: null },
        { productId: 'p6', rong: -3, tonTai: true, gopVao: 'p9' }, { productId: 'p7', rong: -1.9999, tonTai: true, gopVao: null },
    ])
    ok('2a. chỉ cộng phần CÒN ÂM, làm tròn', JSON.stringify(k.cong) === JSON.stringify([{ productId: 'p1', soLuong: 2 }, { productId: 'p7', soLuong: 2 }]), k.cong)
    ok('2b. hàng đã xoá / đã gộp mã → không tự cộng, báo lại', k.boQua.length === 2 && k.boQua.some(s => s.includes('gộp vào p9')), k.boQua)
    const bt = butToanDao({ reference: 'SALE-ONLINE-SPE-A', debitAccount: '131-SHOPEE', debitAccountName: 'PT', creditAccount: '511', creditAccountName: 'DT', amount: 100000, referenceType: 'online', branchId: null }, 'SPE-A', '2026-10-21')
    ok('2c. bút toán đảo đổi chỗ Nợ/Có, cùng số tiền, ref REV-, ngày hôm nay',
        bt.debitAccount === '511' && bt.creditAccount === '131-SHOPEE' && bt.amount === 100000 && bt.reference === 'REV-SALE-ONLINE-SPE-A' && bt.date === '2026-10-21', bt)

    /* 3 — chạy thử: KHÔNG ghi gì */
    {
        const s = soGia()
        const kq = await suaPhieuDonDaXoa(s.sp, { apply: false, tu: 0, gioiHan: 50, hanMs: 60_000, homNay: '2026-10-21' }, { taoCong: s.taoCong, chinhKho: s.chinhKho as any })
        const kh = (m: string) => kq.keHoach.find(x => x.ma === `SPE-${m}`)!
        ok('3a. chạy thử: không UPDATE, không phiếu kho, không chỉnh tồn, không bút toán',
            s.ghi.update.length === 0 && s.ghi.kho.length === 0 && s.ghi.chinhKho.length === 0 && s.ghi.butToan.length === 0, s.ghi)
        ok('3b. kế hoạch: A huỷ+kho, B giao thất bại huỷ+kho, C hoàn tiền có phiếu trả huỷ+kho, D hoàn tiền (phiếu trả bị từ chối) chỉ huỷ',
            kh('A').hanhDong === 'huy-phieu-cong-kho' && kh('B').hanhDong === 'huy-phieu-cong-kho' && kh('C').hanhDong === 'huy-phieu-cong-kho' && kh('D').hanhDong === 'huy-phieu',
            ['A', 'B', 'C', 'D'].map(m => `${m}:${kh(m).hanhDong}`))
        ok('3c. E (khác — có thực nhận dương), F (đã huỷ), G (đơn gốc có lại) → bỏ qua',
            ['E', 'F', 'G'].every(m => kh(m).hanhDong === 'bo-qua'), ['E', 'F', 'G'].map(m => `${m}:${kh(m).lyDo}`))
        ok('3d. kho của C: cộng 2 cái p1, KHÔNG tự cộng p2 đã gộp mã (báo lại)', JSON.stringify(kh('C').kho) === JSON.stringify([{ productId: 'p1', soLuong: 2 }]) && kh('C').khoBoQua.length === 1, kh('C'))
        ok('3e. A có 2 bút toán sẽ đảo; B kèm HĐĐT để xuất cho kế toán', kh('A').butToan.length === 2 && kh('B').hoaDon[0]?.invoiceNumber === '00000123', [kh('A').butToan, kh('B').hoaDon])
    }

    /* 4 — ghi thật, rồi chạy LẠI lần hai */
    {
        const s = soGia()
        const run = () => suaPhieuDonDaXoa(s.sp, { apply: true, tu: 0, gioiHan: 50, hanMs: 60_000, homNay: '2026-10-21' }, { taoCong: s.taoCong, chinhKho: s.chinhKho as any })
        const kq1 = await run()
        ok('4a. huỷ đúng 4 phiếu A, B, C, D', JSON.stringify(s.ghi.update.sort()) === JSON.stringify(['tA', 'tB', 'tC', 'tD']), s.ghi.update)
        ok('4b. cộng kho đúng 2 cái p1 cho mỗi A, B, C — D không cộng, p2 đã gộp không cộng',
            s.ghi.chinhKho.length === 3 && s.ghi.chinhKho.every(x => x.productId === 'p1' && x.delta === 2), s.ghi.chinhKho)
        ok('4c. mỗi lần cộng có phiếu kho "in" cùng referenceId, lý do rõ', s.ghi.kho.length === 3 && s.ghi.kho.every(x => x.type === 'in' && x.quantity === 2 && x.reason === LY_DO_KHO && /^ONLINE-SPE-[ABC]$/.test(x.referenceId)), s.ghi.kho)
        ok('4d. đảo đúng 2 bút toán của A', JSON.stringify(s.ghi.butToan.sort()) === JSON.stringify(['REV-COGS-ONLINE-SPE-A', 'REV-SALE-ONLINE-SPE-A']), s.ghi.butToan)
        ok('4e. không có câu nào ghi vào EInvoice', s.ghi.einvoice === 0)
        ok('4f. thẻ kho A/B/C sau sửa: phần p1 về 0', ['A', 'B', 'C'].every(m => s.the.filter(x => x.referenceId === `ONLINE-SPE-${m}` && x.productId === 'p1').reduce((a, x) => a + x.quantity, 0) === 0))
        const truoc = { update: s.ghi.update.length, kho: s.ghi.kho.length, chinh: s.ghi.chinhKho.length, bt: s.ghi.butToan.length }
        const kq2 = await run()
        ok('4g. CHẠY LẠI: không huỷ thêm, không cộng kho thêm, không đảo thêm',
            s.ghi.update.length === truoc.update && s.ghi.kho.length === truoc.kho && s.ghi.chinhKho.length === truoc.chinh && s.ghi.butToan.length === truoc.bt,
            { truoc, sau: { update: s.ghi.update.length, kho: s.ghi.kho.length, chinh: s.ghi.chinhKho.length, bt: s.ghi.butToan.length } })
        ok('4h. lần 2 các phiếu đã huỷ hiện "bỏ qua — phiếu đã voided"', ['A', 'B', 'C', 'D'].every(m => kq2.keHoach.find(x => x.ma === `SPE-${m}`)!.hanhDong === 'bo-qua'))
        ok('4i. tổng lần 1 đếm đúng 4 phiếu đã huỷ, 6 cái đã cộng, 2 bút toán đã đảo',
            Object.values(kq1.theoHanhDong).reduce((a, x) => a + x.daHuy, 0) === 4 && Object.values(kq1.theoHanhDong).reduce((a, x) => a + x.daCongCai, 0) === 6
            && Object.values(kq1.theoHanhDong).reduce((a, x) => a + x.daDaoBt, 0) === 2, kq1.theoHanhDong)
    }

    /* 5 — khoá sổ */
    {
        const s = soGia({ khoaSo: '2026-08-31' })
        await suaPhieuDonDaXoa(s.sp, { apply: true, tu: 0, gioiHan: 50, hanMs: 60_000 }, { taoCong: s.taoCong, chinhKho: s.chinhKho as any })
        ok('5a. kỳ khoá sổ tới 31/08 → không phiếu tháng 8 nào bị đụng', s.ghi.update.length === 0 && s.ghi.chinhKho.length === 0 && s.ghi.butToan.length === 0, s.ghi)
        const s2 = soGia({ khoaSoHong: true })
        let nem = ''
        try { await suaPhieuDonDaXoa(s2.sp, { apply: true, tu: 0, gioiHan: 50, hanMs: 60_000 }, { taoCong: s2.taoCong, chinhKho: s2.chinhKho as any }) } catch (e: any) { nem = e.message }
        ok('5b. đọc khoá sổ HỎNG khi ghi thật → DỪNG, không ghi gì', /khoá sổ/.test(nem) && s2.ghi.update.length === 0, nem)
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
