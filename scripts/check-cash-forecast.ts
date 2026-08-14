/**
 * Kiểm chứng LỊCH TIỀN 90 NGÀY TỚI.
 *
 * Chạy:  npx tsx scripts/check-cash-forecast.ts
 *
 * Module này nói câu nặng nhất trong cả phần mềm: "ngày X bạn hết tiền". Nói
 * sai một lần là người dùng đi vay nóng không cần thiết, hoặc tệ hơn, lần sau
 * họ bỏ qua đúng lúc cảnh báo là thật.
 *
 * Trọng tâm bộ test:
 *  - phân biệt khoản CHẮC CHẮN với khoản ƯỚC TÍNH, không trộn;
 *  - chưa nhập số dư thì KHÔNG được vẽ đường số dư như thật;
 *  - công nợ khách KHÔNG được rải lên lịch (sổ không có hạn thu);
 *  - mốc thuế chưa lập tờ khai thì hiện ngày, không đoán số.
 */

import { duBaoDongTien } from '../src/lib/cashForecast'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const NGAY = (n: number) => new Date(Date.now() + n * 86400_000)
const chuoiNgay = (n: number) => new Date(Date.now() + n * 86400_000 + 7 * 3600_000).toISOString().slice(0, 10)

interface Kho {
    taiKhoan?: any[]
    thuMoiNgay?: number
    soNgayThu?: number
    chiPhi?: number
    phieuNhap?: any[]
    mocThue?: any[]
    toKhai?: any[]
    noKhach?: number
    /** Cửa hàng thu tiền lần đầu cách đây bao nhiêu ngày (null = lâu hơn cửa sổ đo). */
    tuoiNgay?: number | null
}

function fakePrisma(k: Kho, loi?: Record<string, boolean>) {
    const no = (t: string) => { if (loi?.[t]) throw new Error(`relation "${t}" does not exist`) }
    return {
        bankAccount: { findMany: async () => { no('BankAccount'); return k.taiKhoan || [] } },
        $queryRawUnsafe: async () => {
            no('Payment')
            /* `tien` là TỔNG cả cửa sổ. Fixture khai theo "mỗi ngày × 60" nên
             * khi đặt tuoiNgay ngắn hơn, tổng vẫn giữ nguyên — đúng tình huống
             * cần bắt: cùng một số tiền, chia cho mẫu số nào mới ra tốc độ đúng. */
            return [{
                tien: (k.thuMoiNgay ?? 0) * 60,
                soNgay: k.soNgayThu ?? 60,
                lanThuDauTien: k.tuoiNgay == null ? null
                    : new Date(Date.now() - k.tuoiNgay * 86400_000).toISOString(),
            }]
        },
        expense: { aggregate: async () => { no('Expense'); return { _sum: { amount: (k.chiPhi ?? 0) * 60 } } } },
        importReceipt: { findMany: async () => { no('ImportReceipt'); return k.phieuNhap || [] } },
        taxDeadline: { findMany: async () => { no('TaxDeadline'); return k.mocThue || [] } },
        taxDeclaration: { findMany: async () => k.toKhai || [] },
        customer: { aggregate: async () => ({ _sum: { debt: k.noKhach ?? 0 } }) },
    }
}

async function main() {
    console.log('\n▶ Chưa nhập số dư — KHÔNG được vẽ đường số dư như thật\n')

    const khongSoDu = await duBaoDongTien(fakePrisma({ thuMoiNgay: 1_000_000, chiPhi: 500_000 }))
    ok('không có tài khoản → cờ coSoDuDau = false', khongSoDu.soDuDau.coSoDuDau === false)
    ok('… và cảnh báo nói rõ đây không phải số dư thật',
        khongSoDu.canhBao.some(c => /không phải số dư thật/.test(c)), khongSoDu.canhBao)
    ok('… KHÔNG kêu "hết tiền ngày X"',
        !khongSoDu.canhBao.some(c => /chạm âm/.test(c)), khongSoDu.canhBao)

    const soDu0 = await duBaoDongTien(fakePrisma({ taiKhoan: [{ id: 'B1', bankName: 'A', balance: 0 }] }))
    ok('có tài khoản nhưng số dư 0 → vẫn coi là chưa nhập', soDu0.soDuDau.coSoDuDau === false)

    console.log('\n▶ Có số dư — dựng lịch và tìm ngày chạm đáy\n')

    const r = await duBaoDongTien(fakePrisma({
        taiKhoan: [{ id: 'B1', bankName: 'VCB', balance: 100_000_000 }],
        thuMoiNgay: 2_000_000,
        chiPhi: 1_000_000,
    }), { soNgay: 30 })
    ok('có số dư đầu', r.soDuDau.coSoDuDau && r.soDuDau.tienNganHang === 100_000_000)
    ok('lịch đủ 30 ngày', r.ngay.length === 30)
    ok('thu ước tính mỗi ngày đúng', r.uocTinh.thuMoiNgay === 2_000_000, r.uocTinh)
    ok('chi vận hành ước tính đúng', r.uocTinh.chiVanHanhMoiNgay === 1_000_000)
    /* Mỗi ngày dư 1 triệu, 30 ngày → cuối kỳ 130 triệu. */
    ok('số dư cuối kỳ cộng dồn đúng', r.tomTat.soDuCuoiKy === 130_000_000, r.tomTat.soDuCuoiKy)
    ok('không có ngày cạn tiền', r.ngayCanTien === null)

    console.log('\n▶ Nợ nhà cung cấp — khoản CHẮC CHẮN, có ngày\n')

    const rNcc = await duBaoDongTien(fakePrisma({
        taiKhoan: [{ id: 'B1', bankName: 'VCB', balance: 10_000_000 }],
        thuMoiNgay: 1_000_000,
        chiPhi: 500_000,
        phieuNhap: [
            { code: 'PN1', supplierName: 'NCC A', totalCost: 50_000_000, paidAmount: 0, dueDate: NGAY(10) },
            { code: 'PN2', supplierName: 'NCC B', totalCost: 20_000_000, paidAmount: 20_000_000, dueDate: NGAY(12) },
        ],
    }), { soNgay: 30 })
    ok('cộng đúng 50 triệu nợ đến hạn', rNcc.tomTat.noNccDenHan === 50_000_000, rNcc.tomTat.noNccDenHan)
    ok('phiếu đã trả đủ KHÔNG được tính lại', rNcc.tomTat.noNccDenHan === 50_000_000)
    const ngay10 = rNcc.ngay.find(n => n.ngay === chuoiNgay(10))
    ok('khoản rơi đúng ngày đến hạn', !!ngay10 && ngay10.muc.some(m => m.nhom === 'no-ncc' && m.soTien === 50_000_000), ngay10?.muc)
    ok('khoản nợ NCC được đánh dấu CHẮC CHẮN',
        !!ngay10?.muc.find(m => m.nhom === 'no-ncc')?.chacChan)
    ok('tiền bán hàng được đánh dấu ƯỚC TÍNH',
        ngay10?.muc.find(m => m.nhom === 'ban-hang')?.chacChan === false)
    ok('nhận ra ngày cạn tiền', rNcc.ngayCanTien === chuoiNgay(10), [rNcc.ngayCanTien, chuoiNgay(10)])
    ok('… và cảnh báo nói ra ngày đó', rNcc.canhBao.some(c => c.includes(chuoiNgay(10))), rNcc.canhBao)

    /* Khoản đã quá hạn vẫn phải trả — dồn vào ngày mai chứ không bỏ ra ngoài
     * cửa sổ, nếu không thì áp lực tiền sát nhất lại là thứ bị giấu. */
    const rQuaHan = await duBaoDongTien(fakePrisma({
        taiKhoan: [{ id: 'B1', bankName: 'VCB', balance: 100_000_000 }],
        phieuNhap: [{ code: 'PN9', supplierName: 'NCC C', totalCost: 30_000_000, paidAmount: 0, dueDate: NGAY(-20) }],
    }), { soNgay: 30 })
    ok('khoản quá hạn không bị bỏ sót', rQuaHan.tomTat.noNccDenHan === 30_000_000, rQuaHan.tomTat.noNccDenHan)
    const mai = rQuaHan.ngay.find(n => n.ngay === chuoiNgay(1))
    ok('… được dồn vào ngày mai', !!mai?.muc.some(m => m.nhom === 'no-ncc'), mai?.muc)
    ok('… và ghi rõ là đã quá hạn', !!mai?.muc.find(m => m.nhom === 'no-ncc')?.moTa.includes('quá hạn'))

    console.log('\n▶ Thuế — biết ngày mà chưa biết số thì KHÔNG đoán\n')

    const rThue = await duBaoDongTien(fakePrisma({
        taiKhoan: [{ id: 'B1', bankName: 'VCB', balance: 100_000_000 }],
        mocThue: [
            { taxType: '01_GTGT', period: 'T07/2026', dueDate: chuoiNgay(5), description: 'Tờ khai GTGT' },
            { taxType: '01_GTGT', period: 'T08/2026', dueDate: chuoiNgay(20), description: 'Tờ khai GTGT' },
        ],
        toKhai: [{ period: '2026-07', ct38: 8_000_000, ct40a: 0 }],
    }), { soNgay: 30 })
    ok('mốc có tờ khai → lấy đúng số tiền từ [38]', rThue.tomTat.thueDenHan === 8_000_000, rThue.tomTat.thueDenHan)
    ok('mốc chưa lập tờ khai → đếm riêng, không đoán số', rThue.tomTat.thueChuaRoSoTien === 1, rThue.tomTat)
    const mocChua = rThue.ngay.find(n => n.ngay === chuoiNgay(20))?.muc.find(m => m.nhom === 'thue')
    ok('… hiện đúng ngày kèm lời "chưa biết số tiền"',
        !!mocChua && mocChua.soTien === 0 && /chưa biết số tiền/.test(mocChua.moTa), mocChua)
    ok('… và ghi chú cảnh báo số dư thật sẽ THẤP HƠN đường vẽ',
        rThue.ghiChu.some(g => /THẤP HƠN/.test(g)), rThue.ghiChu)

    console.log('\n▶ Công nợ khách — KHÔNG được rải lên lịch\n')

    const rNo = await duBaoDongTien(fakePrisma({
        taiKhoan: [{ id: 'B1', bankName: 'VCB', balance: 10_000_000 }],
        phieuNhap: [{ code: 'PN1', supplierName: 'A', totalCost: 50_000_000, paidAmount: 0, dueDate: NGAY(5) }],
        noKhach: 200_000_000,
    }), { soNgay: 30 })
    ok('tổng nợ khách để riêng', rNo.tomTat.noKhachChuaCoHan === 200_000_000)
    ok('KHÔNG có dòng thu nào từ nợ khách trên lịch',
        !rNo.ngay.some(n => n.muc.some(m => m.nhom === 'no-khach')))
    ok('… nên vẫn báo cạn tiền dù "trên giấy" có 200 triệu nợ phải thu',
        rNo.ngayCanTien !== null, rNo.ngayCanTien)
    ok('… và giải thích vì sao không cộng vào',
        rNo.ghiChu.some(g => /đừng cộng sẵn/.test(g)), rNo.ghiChu)

    console.log('\n▶ Đọc hỏng bảng — ghi nhận, không im lặng bịa số\n')

    const rHong = await duBaoDongTien(fakePrisma({
        taiKhoan: [{ id: 'B1', bankName: 'VCB', balance: 50_000_000 }],
        thuMoiNgay: 1_000_000,
    }, { ImportReceipt: true }), { soNgay: 30 })
    ok('hỏng bảng phiếu nhập → không sập', rHong.ngay.length === 30)
    /* Nợ nhà cung cấp là khoản CHẮC CHẮN phải trả — đọc hỏng nó làm lịch tiền
     * trông nhẹ hơn thực tế, nên nó thuộc nhóm thiếu NGHIÊM TRỌNG, không phải
     * thiếu phụ. Bản tin tuần dựa vào đúng phân loại này để quyết định im lặng. */
    ok('… ghi vào mục thiếu NGHIÊM TRỌNG',
        rHong.thieuChinh.some(t => /ImportReceipt|công nợ nhà cung cấp/.test(t)), rHong.thieuChinh)
    ok('… và nợ NCC để 0 chứ không bịa', rHong.tomTat.noNccDenHan === 0)

    console.log('\n▶ Ít ngày phát sinh thu — phải nói mức ước tính còn yếu\n')

    const rYeu = await duBaoDongTien(fakePrisma({
        taiKhoan: [{ id: 'B1', bankName: 'VCB', balance: 50_000_000 }],
        thuMoiNgay: 500_000,
        soNgayThu: 8,
    }), { soNgay: 30 })
    ok('cảnh báo mức thu ước tính còn yếu',
        rYeu.ghiChu.some(g => /đừng dựa vào nó/.test(g)), rYeu.ghiChu)
    ok('luôn nói rõ tiền bán lấy từ PHIẾU THU, không lấy tổng đơn',
        rYeu.ghiChu.some(g => /PHIẾU THU/.test(g)))

    console.log('\n▶ Mẫu số của phép trung bình — cửa hàng mới không bị dìm tốc độ thu\n')
    {
        // Lâu năm: bán 32/60 ngày. Ngày nghỉ VẪN là ngày trong lịch dự báo → chia 60.
        const cu = await duBaoDongTien(fakePrisma({
            taiKhoan: [{ balance: 100_000_000 }], thuMoiNgay: 1_000_000, soNgayThu: 32, tuoiNgay: null,
        }), { soNgay: 30 })
        ok('cửa hàng lâu năm nghỉ nhiều ngày vẫn chia cho 60',
            cu.uocTinh.soNgayLayTrungBinh === 60 && cu.uocTinh.thuMoiNgay === 1_000_000,
            [cu.uocTinh.soNgayLayTrungBinh, cu.uocTinh.thuMoiNgay])
        ok('… và nói rõ ngày không bán vẫn được tính là một ngày',
            /Ngày không bán vẫn tính/.test(cu.uocTinh.cachTinh), cu.uocTinh.cachTinh)
    }
    {
        /* Mới mở 20 ngày, thu tổng đúng bằng cửa hàng trên. Chia cho 60 sẽ ra
         * tốc độ chỉ bằng 1/3 và lịch tiền vẽ ra cảnh sắp cạn tiền không có thật. */
        const moi = await duBaoDongTien(fakePrisma({
            taiKhoan: [{ balance: 100_000_000 }], thuMoiNgay: 1_000_000, soNgayThu: 20, tuoiNgay: 20,
        }), { soNgay: 30 })
        ok('cửa hàng mới 20 ngày thì chia cho 20, không chia cho 60',
            moi.uocTinh.soNgayLayTrungBinh === 20, moi.uocTinh.soNgayLayTrungBinh)
        ok('… nên tốc độ thu gấp 3 lần cách tính cũ',
            moi.uocTinh.thuMoiNgay === 3_000_000, moi.uocTinh.thuMoiNgay)
        ok('… và câu giải thích nêu đúng lý do dùng mẫu số khác',
            /không chia cho 60/.test(moi.uocTinh.cachTinh), moi.uocTinh.cachTinh)
    }
    {
        // Đúng ranh giới 60 ngày thì không đổi gì
        const ranh = await duBaoDongTien(fakePrisma({
            taiKhoan: [{ balance: 100_000_000 }], thuMoiNgay: 1_000_000, soNgayThu: 60, tuoiNgay: 61,
        }), { soNgay: 30 })
        ok('thu lần đầu ngoài cửa sổ đo thì giữ mẫu số 60',
            ranh.uocTinh.soNgayLayTrungBinh === 60, ranh.uocTinh.soNgayLayTrungBinh)
    }
    {
        // Mẫu số không bao giờ được bằng 0 (chia cho 0 ra Infinity, vẽ đường vô nghĩa)
        const hnay = await duBaoDongTien(fakePrisma({
            taiKhoan: [{ balance: 10_000_000 }], thuMoiNgay: 1_000_000, soNgayThu: 1, tuoiNgay: 0,
        }), { soNgay: 30 })
        ok('cửa hàng thu lần đầu ngay hôm nay vẫn ra số hữu hạn',
            Number.isFinite(hnay.uocTinh.thuMoiNgay) && hnay.uocTinh.soNgayLayTrungBinh >= 1,
            [hnay.uocTinh.soNgayLayTrungBinh, hnay.uocTinh.thuMoiNgay])
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
