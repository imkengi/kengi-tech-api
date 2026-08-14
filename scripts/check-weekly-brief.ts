/**
 * Kiểm chứng BẢN TIN ĐẦU TUẦN.
 *
 * Chạy:  npx tsx scripts/check-weekly-brief.ts
 *
 * Đây là thông báo GỬI ĐỀU HẰNG TUẦN — loại dễ trở thành rác nhất trong cả phần
 * mềm. Một bản tin nhạt tuần thứ ba là người dùng tắt vĩnh viễn, và tuần thứ
 * mười có tin thật thì không ai đọc.
 *
 * Nên gần như toàn bộ bộ test này là các ca PHẢI IM LẶNG.
 */

import { ghepBanTin, maTuan, banTinChoStore } from '../src/cron/weeklyBriefCron'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const tienSach = (sua: any = {}) => ({
    soDuDau: { coSoDuDau: true },
    ngayCanTien: null,
    diemChamDay: { ngay: '2026-08-20', soDu: 100_000_000 },
    tomTat: { tongChiChacChan: 10_000_000, noKhachChuaCoHan: 0 },
    thieu: [],
    ...sua,
})
const khoSach = (sua: any = {}) => ({
    hetHang: [], canDat: [],
    tomTat: { vonKetODongHang: 0, soMaTonDong: 0 },
    thieu: [],
    ...sua,
})

async function main() {
    console.log('\n▶ Không có gì đáng nói — TUYỆT ĐỐI không gửi\n')

    ok('mọi thứ ổn → không có bản tin', ghepBanTin(tienSach(), khoSach()) === null)
    ok('không gửi kiểu "tuần này mọi thứ ổn"', ghepBanTin(tienSach(), khoSach()) === null)

    console.log('\n▶ Chưa nhập số dư — không bao giờ được doạ hết tiền\n')

    const chuaNhap = ghepBanTin(
        tienSach({ soDuDau: { coSoDuDau: false }, ngayCanTien: '2026-08-25' }),
        khoSach())
    ok('coSoDuDau=false + có ngày cạn → vẫn IM', chuaNhap === null, chuaNhap)

    console.log('\n▶ Sắp cạn tiền — phải báo, và báo cho ra hồn\n')

    const canTien = ghepBanTin(
        tienSach({ ngayCanTien: '2026-08-25', tomTat: { tongChiChacChan: 80_000_000, noKhachChuaCoHan: 200_000_000 } }),
        khoSach())
    ok('có báo', !!canTien)
    ok('… nêu đúng ngày', !!canTien && canTien.noiDung.includes('2026-08-25'))
    ok('… nêu số phải trả chắc chắn', !!canTien && canTien.noiDung.includes('80.000.000đ'))
    ok('… gợi đòi nợ khách vì đó là cách rẻ nhất',
        !!canTien && /đi đòi sớm/.test(canTien.noiDung), canTien?.noiDung)
    ok('… tiêu đề nói có việc cần xử lý', !!canTien && /cần xử lý/.test(canTien.tieuDe))

    /* Đáy mỏng hơn số phải trả: đáng nhắc nhưng KHÔNG phải mức báo động, và tự
     * nó không đủ để gọi là "có việc cần xử lý". */
    const dayMong = ghepBanTin(
        tienSach({ diemChamDay: { ngay: '2026-08-22', soDu: 5_000_000 }, tomTat: { tongChiChacChan: 50_000_000, noKhachChuaCoHan: 0 } }),
        khoSach())
    ok('đáy mỏng → có nhắc', !!dayMong && /chạm đáy/.test(dayMong.noiDung))
    ok('… nhưng tiêu đề KHÔNG leo thang thành báo động',
        !!dayMong && !/cần xử lý/.test(dayMong.tieuDe), dayMong?.tieuDe)

    const dayDay = ghepBanTin(
        tienSach({ diemChamDay: { ngay: '2026-08-22', soDu: 500_000_000 }, tomTat: { tongChiChacChan: 50_000_000, noKhachChuaCoHan: 0 } }),
        khoSach())
    ok('đáy vẫn dày hơn số phải trả → im', dayDay === null)

    console.log('\n▶ Kho — chỉ nhắc thứ thật sự phải làm tuần này\n')

    const hetVun = ghepBanTin(tienSach(), khoSach({
        hetHang: [{ ten: 'Hàng ế', matMoiNgay: 50_000 }],
    }))
    ok('mã hết hàng nhưng mất 50k/ngày → im (dưới ngưỡng)', hetVun === null, hetVun)

    const hetTo = ghepBanTin(tienSach(), khoSach({
        hetHang: [
            { ten: 'Cà phê hạt', matMoiNgay: 800_000 },
            { ten: 'Phin pha', matMoiNgay: 300_000 },
        ],
    }))
    ok('mã hết hàng mất 800k/ngày → báo', !!hetTo && /Cà phê hạt/.test(hetTo.noiDung))
    ok('… kèm số tiền mất mỗi ngày', !!hetTo && /800\.000đ\/ngày/.test(hetTo.noiDung), hetTo?.noiDung)

    /* Mã còn bán được 20 ngày mà chờ hàng 7 ngày thì KHÔNG việc gì phải làm phiền
     * sáng thứ Hai — đó là "đáng biết", không phải "phải làm". */
    const conKip = ghepBanTin(tienSach(), khoSach({
        canDat: [{ ten: 'Đường phèn', conBanDuoc: 20, soNgayCho: 7, tienCanBo: 5_000_000 }],
    }))
    ok('còn 20 ngày, chờ hàng 7 ngày → im', conKip === null, conKip)

    const sapDut = ghepBanTin(tienSach(), khoSach({
        canDat: [
            { ten: 'Đường phèn', conBanDuoc: 3, soNgayCho: 7, tienCanBo: 5_000_000 },
            { ten: 'Ly giữ nhiệt', conBanDuoc: 20, soNgayCho: 7, tienCanBo: 9_000_000 },
        ],
    }))
    ok('còn 3 ngày mà chờ hàng 7 ngày → báo', !!sapDut && /Đường phèn/.test(sapDut.noiDung))
    ok('… KHÔNG lôi mã còn kịp vào cùng', !!sapDut && !/Ly giữ nhiệt/.test(sapDut.noiDung), sapDut?.noiDung)
    ok('… chỉ cộng vốn của mã thật sự gấp', !!sapDut && /5\.000\.000đ/.test(sapDut.noiDung), sapDut?.noiDung)

    console.log('\n▶ Mối nối hai cỗ máy: cần vốn nhập so với tiền đang có\n')

    const khongDuVon = ghepBanTin(
        tienSach({ diemChamDay: { ngay: '2026-08-22', soDu: 40_000_000 }, tomTat: { tongChiChacChan: 10_000_000, noKhachChuaCoHan: 0 } }),
        khoSach({ canDat: [{ ten: 'Nồi chiên', conBanDuoc: 2, soNgayCho: 7, tienCanBo: 300_000_000 }] }))
    ok('cần 300tr nhập mà đáy tiền chỉ 40tr → cảnh báo ghép',
        !!khongDuVon && /ghép hai con số/.test(khongDuVon.noiDung), khongDuVon?.noiDung)
    ok('… gợi xếp thứ tự thay vì nhập hết một lượt',
        !!khongDuVon && /xếp thứ tự/.test(khongDuVon.noiDung))

    const duVon = ghepBanTin(
        tienSach({ diemChamDay: { ngay: '2026-08-22', soDu: 900_000_000 }, tomTat: { tongChiChacChan: 10_000_000, noKhachChuaCoHan: 0 } }),
        khoSach({ canDat: [{ ten: 'Nồi chiên', conBanDuoc: 2, soNgayCho: 7, tienCanBo: 300_000_000 }] }))
    ok('tiền dư dả → KHÔNG cảnh báo ghép',
        !!duVon && !/ghép hai con số/.test(duVon.noiDung), duVon?.noiDung)

    /* Chưa nhập số dư thì không có vế tiền để so — không được đoán là thiếu vốn. */
    const chuaCoSoDu = ghepBanTin(
        tienSach({ soDuDau: { coSoDuDau: false }, diemChamDay: { ngay: '2026-08-22', soDu: -5_000_000 } }),
        khoSach({ canDat: [{ ten: 'Nồi chiên', conBanDuoc: 2, soNgayCho: 7, tienCanBo: 300_000_000 }] }))
    ok('chưa nhập số dư → không cảnh báo thiếu vốn',
        !!chuaCoSoDu && !/ghép hai con số/.test(chuaCoSoDu.noiDung), chuaCoSoDu?.noiDung)

    console.log('\n▶ Vốn đọng — không tự nó đánh thức ai\n')

    const chiDong = ghepBanTin(tienSach(), khoSach({
        tomTat: { vonKetODongHang: 90_000_000, soMaTonDong: 30 },
    }))
    ok('chỉ có vốn đọng → KHÔNG gửi bản tin', chiDong === null, chiDong)

    const kemDong = ghepBanTin(tienSach(), khoSach({
        hetHang: [{ ten: 'Cà phê hạt', matMoiNgay: 800_000 }],
        tomTat: { vonKetODongHang: 90_000_000, soMaTonDong: 30 },
    }))
    ok('có việc gấp rồi thì mới nhân tiện nhắc vốn đọng',
        !!kemDong && /nằm chết/.test(kemDong.noiDung))

    console.log('\n▶ Mã tuần — chống gửi trùng, không vỡ ở giao thừa\n')

    ok('thứ Hai và Chủ nhật cùng tuần cho cùng mã',
        maTuan(new Date('2026-08-10T00:00:00Z')) === maTuan(new Date('2026-08-16T00:00:00Z')),
        [maTuan(new Date('2026-08-10T00:00:00Z')), maTuan(new Date('2026-08-16T00:00:00Z'))])
    ok('tuần sau đổi mã',
        maTuan(new Date('2026-08-10T00:00:00Z')) !== maTuan(new Date('2026-08-17T00:00:00Z')))
    ok('31/12/2025 và 01/01/2026 cùng tuần ISO → cùng mã',
        maTuan(new Date('2025-12-31T00:00:00Z')) === maTuan(new Date('2026-01-01T00:00:00Z')),
        [maTuan(new Date('2025-12-31T00:00:00Z')), maTuan(new Date('2026-01-01T00:00:00Z'))])

    console.log('\n▶ Chạm DB — không gửi lại, không gửi khi đọc hỏng\n')

    let daTao = 0
    const fake = (opt: { daCo?: boolean; hong?: boolean }) => ({
        notification: {
            findFirst: async () => (opt.daCo ? { id: 'N1' } : null),
            create: async () => { daTao++; return {} },
        },
        bankAccount: { findMany: async () => [{ id: 'B1', bankName: 'A', balance: 100_000_000 }] },
        $queryRawUnsafe: async () => { if (opt.hong) throw new Error('relation "Payment" does not exist'); return [{ tien: 0, soNgay: 0 }] },
        expense: { aggregate: async () => ({ _sum: { amount: 0 } }) },
        importReceipt: { findMany: async () => [] },
        taxDeadline: { findMany: async () => [] },
        taxDeclaration: { findMany: async () => [] },
        customer: { aggregate: async () => ({ _sum: { debt: 0 } }) },
        product: { findMany: async () => [] },
        purchaseOrder: { findMany: async () => [] },
        category: { findMany: async () => [] },
    })

    daTao = 0
    ok('tuần đã gửi → không gửi lại',
        (await banTinChoStore(fake({ daCo: true }), 'CH A', 'tuần 2026-W33')) === false && daTao === 0, daTao)

    daTao = 0
    ok('đọc hỏng dữ liệu → không gửi gì',
        (await banTinChoStore(fake({ hong: true }), 'CH B', 'tuần 2026-W33')) === false && daTao === 0, daTao)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
