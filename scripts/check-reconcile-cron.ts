/**
 * Kiểm chứng CRON NHẮC ĐỐI CHIẾU BA CHIỀU.
 *
 * Chạy:  npx tsx scripts/check-reconcile-cron.ts
 *
 * Thông báo đẩy là thứ dễ mất lòng tin nhất: người dùng chỉ cần nhận hai cái
 * thông báo vô nghĩa là tắt vĩnh viễn cả loại đó, kể cả cái thứ ba có quan
 * trọng đến đâu. Nên bộ test này tập trung vào NGƯỠNG IM LẶNG.
 */

import { dungLoiNhac, kyThangTruoc, doiChieuChoStore } from '../src/cron/reconcileCron'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

/** Kết quả đối chiếu giả — chỉ những trường mà cron thực sự đọc. */
function kq(sua: any = {}): any {
    return {
        ky: { nhan: 'tháng 7/2026' },
        soSach: { duocKetLuan: true, tong: 100_000_000 },
        hoaDon: { duocKetLuan: true },
        dongTien: { duocKetLuan: true, chuaGiaiThich: 0 },
        lech: { chuaXuatHoaDon: 0, hoaDonVuotSo: 0, tyLeXuatHoaDon: 100 },
        chiTienMatLon: { danhSach: [], tongVatMat: 0 },
        thieu: [],
        ...sua,
    }
}

async function main() {
    console.log('\n▶ Xác định kỳ — phải là tháng LIỀN TRƯỚC\n')

    ok('ngày 05/08 → kỳ tháng 7', kyThangTruoc('2026-08-05').maKy === '2026-07', kyThangTruoc('2026-08-05'))
    ok('… đúng ngày đầu và ngày cuối tháng',
        kyThangTruoc('2026-08-05').from === '2026-07-01' && kyThangTruoc('2026-08-05').to === '2026-07-31')
    const quaNam = kyThangTruoc('2026-01-05')
    ok('tháng 1 → lùi về tháng 12 NĂM TRƯỚC', quaNam.maKy === '2025-12', quaNam)
    ok('… và bắt đúng tháng 2 năm nhuận',
        kyThangTruoc('2028-03-05').to === '2028-02-29', kyThangTruoc('2028-03-05'))

    console.log('\n▶ Sổ sạch — TUYỆT ĐỐI không gửi thông báo\n')

    ok('không lệch gì → im lặng', dungLoiNhac(kq()) === null)
    ok('lệch 500k trên doanh thu 100tr → im (dưới cả hai ngưỡng)',
        dungLoiNhac(kq({ lech: { chuaXuatHoaDon: 500_000, hoaDonVuotSo: 0, tyLeXuatHoaDon: 99.5 } })) === null)
    ok('lệch 2,5tr nhưng chỉ 2,5% … thực ra vượt ngưỡng → phải báo',
        dungLoiNhac(kq({ lech: { chuaXuatHoaDon: 2_500_000, hoaDonVuotSo: 0, tyLeXuatHoaDon: 97.5 } })) !== null)
    ok('lệch 3tr nhưng cửa hàng doanh thu 1 tỷ (0,3%) → im',
        dungLoiNhac(kq({ soSach: { duocKetLuan: true, tong: 1_000_000_000 }, lech: { chuaXuatHoaDon: 3_000_000, hoaDonVuotSo: 0, tyLeXuatHoaDon: 99.7 } })) === null)

    console.log('\n▶ Thiếu dữ liệu — không được suy thành sai phạm\n')

    /* Không có hoá đơn nào thì phép trừ sổ↔hoá đơn vô nghĩa, nên TUYỆT ĐỐI không
     * được nói "còn 100 triệu chưa xuất hoá đơn". Cửa hàng này doanh thu quy năm
     * vượt 1 tỷ nên vẫn nhận lời nhắc về NĐ 70/2025 — nhưng đó là lời nhắc về
     * DỮ LIỆU và nghĩa vụ, không phải lời buộc tội. */
    const khongHd = dungLoiNhac(kq({
        hoaDon: { duocKetLuan: false },
        lech: { chuaXuatHoaDon: 100_000_000, hoaDonVuotSo: 0, tyLeXuatHoaDon: 0 },
    }))
    ok('chưa có hoá đơn nào trong phần mềm → KHÔNG nhắc "chưa xuất hoá đơn"',
        !khongHd || !/chưa có hoá đơn \(mới xuất/.test(khongHd.noiDung), khongHd?.noiDung)
    ok('chưa nhập sao kê → KHÔNG nhắc "tiền vào chưa giải trình"',
        dungLoiNhac(kq({ dongTien: { duocKetLuan: false, chuaGiaiThich: 500_000_000 } })) === null)

    console.log('\n▶ Cửa hàng lớn mà không có hoá đơn nào — nói một lần, nói cho đúng\n')

    /* Cửa hàng doanh thu 1,37 tỷ/tháng mà hệ thống không thấy hoá đơn nào: không
     * được tố họ trốn thuế (có thể xuất ở phần mềm khác), nhưng im hoàn toàn
     * cũng sai — đây là ca thật gặp ngày 14/08/2026. */
    const lonKhongHd = dungLoiNhac(kq({
        soSach: { duocKetLuan: true, tong: 1_370_000_000 },
        hoaDon: { duocKetLuan: false },
        lech: { chuaXuatHoaDon: 1_370_000_000, hoaDonVuotSo: 0, tyLeXuatHoaDon: 0 },
    }))
    ok('doanh thu lớn + không hoá đơn nào → có nhắc', !!lonKhongHd)
    ok('… dẫn đúng NĐ 70/2025', !!lonKhongHd && /70\/2025/.test(lonKhongHd.noiDung))
    ok('… KHÔNG tố "chưa xuất hoá đơn 1,37 tỷ"',
        !!lonKhongHd && !/chưa có hoá đơn \(mới xuất/.test(lonKhongHd.noiDung), lonKhongHd?.noiDung)
    ok('… chừa đường cho việc họ xuất ở phần mềm khác',
        !!lonKhongHd && /phần mềm khác/.test(lonKhongHd.noiDung))

    /* Cửa hàng nhỏ chưa tới ngưỡng thì không có nghĩa vụ này — nhắc là làm phiền
     * và còn sai luật. */
    const nhoKhongHd = dungLoiNhac(kq({
        soSach: { duocKetLuan: true, tong: 30_000_000 },
        hoaDon: { duocKetLuan: false },
        lech: { chuaXuatHoaDon: 30_000_000, hoaDonVuotSo: 0, tyLeXuatHoaDon: 0 },
    }))
    ok('doanh thu nhỏ + không hoá đơn → im (chưa tới ngưỡng 1 tỷ/năm)', nhoKhongHd === null, nhoKhongHd)

    console.log('\n▶ Có lệch thật — phải nói rõ và nói đúng\n')

    const l1 = dungLoiNhac(kq({ lech: { chuaXuatHoaDon: 12_000_000, hoaDonVuotSo: 0, tyLeXuatHoaDon: 88 } }))
    ok('bắt lệch 12tr', !!l1)
    ok('… nêu số tiền trong nội dung', !!l1 && l1.noiDung.includes('12.000.000đ'), l1?.noiDung)
    ok('… nhắc mốc ngày 20 để còn kịp khai đúng', !!l1 && /ngày 20/.test(l1.noiDung))
    ok('… chỉ đường tới đúng chỗ xem', !!l1 && /Đối chiếu ba chiều/.test(l1.noiDung))

    const l2 = dungLoiNhac(kq({ lech: { chuaXuatHoaDon: 0, hoaDonVuotSo: 20_000_000, tyLeXuatHoaDon: 120 } }))
    ok('bắt chiều hoá đơn vượt sổ', !!l2 && /nặng hơn/.test(l2.noiDung), l2?.noiDung)

    const l3 = dungLoiNhac(kq({ chiTienMatLon: { danhSach: [1, 2, 3], tongVatMat: 4_000_000 } }))
    ok('nhắc chi tiền mặt mất khấu trừ', !!l3 && /5 triệu/.test(l3.noiDung), l3?.noiDung)
    ok('chi tiền mặt nhưng thuế mất chỉ 100k → im (không đáng phiền)',
        dungLoiNhac(kq({ chiTienMatLon: { danhSach: [1], tongVatMat: 100_000 } })) === null)

    const gop = dungLoiNhac(kq({
        lech: { chuaXuatHoaDon: 12_000_000, hoaDonVuotSo: 0, tyLeXuatHoaDon: 88 },
        dongTien: { duocKetLuan: true, chuaGiaiThich: 30_000_000 },
        chiTienMatLon: { danhSach: [1, 2], tongVatMat: 3_000_000 },
    }))
    ok('gộp nhiều vấn đề vào MỘT thông báo', !!gop && gop.noiDung.split('\n•').length >= 3, gop?.noiDung)
    ok('… tiêu đề nói đúng số điểm', !!gop && /3 điểm/.test(gop.tieuDe), gop?.tieuDe)

    console.log('\n▶ Chạm DB — không nhắc lại kỳ đã nhắc, không nhắc khi đọc hỏng\n')

    let daTao = 0
    const fake = (opt: { daCo?: boolean; hongBang?: boolean }) => ({
        notification: {
            findFirst: async () => (opt.daCo ? { id: 'N1' } : null),
            create: async () => { daTao++; return {} },
        },
        transaction: { findMany: async () => (opt.hongBang ? Promise.reject(new Error('The table `Transaction` does not exist')) : []) },
        onlineOrder: { findMany: async () => [] },
        eInvoice: { findMany: async () => [{ id: 'E1', invoiceNumber: '1', invoiceDate: '2026-07-10', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 0, vatAmount: 0, totalAmount: 0, transactionId: null }] },
        bankTransaction: { findMany: async () => [] },
        payment: { findMany: async () => [] },
        journalEntry: { findMany: async () => [] },
        expense: { findMany: async () => [] },
    })

    daTao = 0
    const daNhacRoi = await doiChieuChoStore(fake({ daCo: true }), 'Cửa hàng A', '2026-08-05')
    ok('kỳ đã nhắc → không nhắc lại', daNhacRoi === false && daTao === 0, daTao)

    daTao = 0
    const docHong = await doiChieuChoStore(fake({ hongBang: true }), 'Cửa hàng B', '2026-08-05')
    ok('đọc hỏng bảng → KHÔNG gửi thông báo nào', docHong === false && daTao === 0, daTao)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
