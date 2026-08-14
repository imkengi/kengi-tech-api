/**
 * Kiểm chứng ĐỐI CHIẾU BA CHIỀU: sổ sách ↔ hoá đơn ↔ dòng tiền.
 *
 * Chạy:  npx tsx scripts/check-revenue-reconcile.ts
 *
 * Module này nói những câu rất nặng: "còn X đồng doanh thu chưa có hoá đơn",
 * "Y đồng vào tài khoản chưa giải trình được". Nói sai một lần là người dùng
 * mất niềm tin vào cả phần thuế và sẽ tắt luôn cảnh báo thật ở lần sau.
 *
 * Nên trọng tâm bộ test là các ca PHẢI IM LẶNG:
 *  - chưa nhập sao kê ngân hàng → không được suy ra "giấu doanh thu",
 *  - hoá đơn trả hàng/điều chỉnh → không được cộng dồn thành "xuất hoá đơn khống",
 *  - hoá đơn đã huỷ → không được tính vào doanh thu đã xuất,
 *  - đọc hỏng bảng → không được quy thành "không có".
 */

import { doiChieuBaChieu, NGUONG_TIEN_MAT } from '../src/lib/revenueReconcile'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const KY = {
    from: '2026-07-01',
    to: '2026-07-31',
    start: new Date('2026-07-01T00:00:00+07:00'),
    end: new Date('2026-08-01T00:00:00+07:00'),
    nhan: 'tháng 7/2026',
}

interface Kho {
    transactions?: any[]
    onlineOrders?: any[]
    invoices?: any[]
    bank?: any[]
    payments?: any[]
    journal?: any[]
    expenses?: any[]
}

/** Khớp `status` cho cả hai dạng: chuỗi trần và { in: [...] }.
 *  Prisma giả phải theo ĐÚNG hình dạng truy vấn thật, nếu không nó sẽ "đạt" cho
 *  một truy vấn mà production không chạy nổi — hoặc ngược lại, kêu hỏng khi mã
 *  nguồn vừa được sửa cho đúng. */
const khopTrangThai = (giaTri: any, dieuKien: any) => {
    if (dieuKien === undefined) return true
    if (dieuKien && Array.isArray(dieuKien.in)) return dieuKien.in.includes(giaTri)
    return giaTri === dieuKien
}

function fakePrisma(k: Kho, loi?: Record<string, boolean>) {
    const trongNgay = (v: any, w: any) => {
        if (!w) return true
        const t = new Date(v).getTime()
        if (w.gte !== undefined && t < new Date(w.gte).getTime()) return false
        if (w.lt !== undefined && !(t < new Date(w.lt).getTime())) return false
        if (w.lte !== undefined && t > new Date(w.lte).getTime()) return false
        return true
    }
    const trongChuoi = (v: string, w: any) => {
        if (!w) return true
        if (w.gte !== undefined && v < w.gte) return false
        if (w.lte !== undefined && v > w.lte) return false
        return true
    }
    const no = (ten: string) => { if (loi?.[ten]) throw new Error(`The table \`${ten}\` does not exist`) }

    return {
        transaction: {
            findMany: async ({ where }: any) => {
                no('transaction')
                return (k.transactions || []).filter(t =>
                    trongNgay(t.createdAt, where?.createdAt) && khopTrangThai(t.status, where?.status))
            },
        },
        onlineOrder: {
            findMany: async ({ where }: any) => {
                no('onlineOrder')
                return (k.onlineOrders || []).filter(o =>
                    trongNgay(o.createdAt, where?.createdAt) &&
                    (!where?.status?.in || where.status.in.includes(o.status)))
            },
        },
        eInvoice: {
            findMany: async ({ where }: any) => {
                no('eInvoice')
                return (k.invoices || []).filter(h => trongChuoi(String(h.invoiceDate || ''), where?.invoiceDate))
            },
        },
        bankTransaction: {
            findMany: async ({ where }: any) => {
                no('bankTransaction')
                return (k.bank || []).filter(b =>
                    trongNgay(b.date, where?.date) && (!where?.type?.in || where.type.in.includes(b.type)))
            },
        },
        payment: {
            findMany: async ({ where }: any) => {
                no('payment')
                return (k.payments || []).filter(p =>
                    (!where?.transactionId?.in || where.transactionId.in.includes(p.transactionId)) &&
                    (!where?.type?.in || where.type.in.includes(p.type)))
            },
        },
        journalEntry: {
            findMany: async ({ where }: any) => {
                no('journalEntry')
                return (k.journal || []).filter(e =>
                    trongChuoi(String(e.date || ''), where?.date) &&
                    (!where?.referenceType || e.referenceType === where.referenceType))
            },
        },
        expense: {
            findMany: async ({ where }: any) => {
                no('expense')
                return (k.expenses || []).filter(e =>
                    trongNgay(e.date, where?.date) &&
                    (!where?.status || e.status === where.status) &&
                    (where?.amount?.gte === undefined || e.amount >= where.amount.gte) &&
                    (where?.bankAccountId !== null || e.bankAccountId == null))
            },
        },
    }
}

const gd = (n: number, tien: number, ngay = '2026-07-10', them: any = {}) => ({
    id: 'T' + n, receiptNumber: 'HD' + n, total: tien,
    createdAt: new Date(`${ngay}T10:00:00+07:00`), status: 'completed',
    vatInvoiceNumber: null, vatStatus: 'none', channel: 'direct', ...them,
})

const hd = (so: string, tien: number, them: any = {}) => ({
    id: 'E' + so, invoiceNumber: so, invoiceDate: '2026-07-10', invoiceType: 'SALE',
    status: 'SIGNED', totalBeforeVat: Math.round(tien / 1.08), vatAmount: tien - Math.round(tien / 1.08),
    totalAmount: tien, transactionId: null, ...them,
})

async function main() {
    console.log('\n▶ Sổ khớp hoá đơn — KHÔNG được báo động\n')

    const sach = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000), gd(2, 500_000)],
        invoices: [hd('001', 1_000_000, { transactionId: 'T1' }), hd('002', 500_000, { transactionId: 'T2' })],
    }), KY)
    ok('sổ và hoá đơn bằng nhau → không có lệch', sach.lech.chuaXuatHoaDon === 0 && sach.lech.hoaDonVuotSo === 0, sach.lech)
    ok('không dựng rủi ro "chưa xuất hoá đơn"', !sach.ruiRo.some(r => r.ma === 'chua-xuat-hoa-don'))
    ok('không dựng rủi ro "hoá đơn vượt sổ"', !sach.ruiRo.some(r => r.ma === 'hoa-don-vuot-so'))
    ok('tỷ lệ xuất hoá đơn đạt 100%', sach.lech.tyLeXuatHoaDon === 100, sach.lech.tyLeXuatHoaDon)

    /* ĐƠN GHI NỢ PHẢI ĐƯỢC TÍNH VÀO SỔ.
     *
     * Đơn bán chịu mang status 'partial'. Nó vẫn là bán thật, vẫn trừ kho, vẫn
     * được xuất hoá đơn. Bỏ nó ra khỏi sổ thì hoá đơn của chính nó trở thành
     * "hoá đơn vượt sổ" — chiều lệch NẶNG NHẤT, tức là phần mềm tố cửa hàng xuất
     * hoá đơn khống trong khi họ bán chịu bình thường.
     *
     * Đã xảy ra thật ngày 14/08/2026: một cửa hàng bị báo lệch ảo 677 triệu. */
    const ghiNo = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000), gd(2, 3_000_000, '2026-07-11', { status: 'partial' })],
        invoices: [hd('001', 1_000_000, { transactionId: 'T1' }), hd('002', 3_000_000, { transactionId: 'T2' })],
    }), KY)
    ok('đơn ghi nợ (partial) được tính vào sổ', ghiNo.soSach.tong === 4_000_000, ghiNo.soSach.tong)
    ok('… nên KHÔNG bị tố "hoá đơn vượt sổ"',
        ghiNo.lech.hoaDonVuotSo === 0 && !ghiNo.ruiRo.some(r => r.ma === 'hoa-don-vuot-so'), ghiNo.lech)

    /* Đơn ĐÃ TRẢ / đã huỷ thì ngược lại: không được tính vào sổ. */
    const daHuy = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000), gd(2, 9_000_000, '2026-07-11', { status: 'cancelled' })],
        invoices: [hd('001', 1_000_000, { transactionId: 'T1' })],
    }), KY)
    ok('đơn huỷ KHÔNG được tính vào sổ', daHuy.soSach.tong === 1_000_000, daHuy.soSach.tong)

    console.log('\n▶ Bán mà chưa xuất hoá đơn — PHẢI báo\n')

    const thieuHd = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000), gd(2, 1_000_000), gd(3, 1_000_000)],
        invoices: [hd('001', 1_000_000, { transactionId: 'T1' })],
    }), KY)
    ok('bắt đúng phần thiếu 2 triệu', thieuHd.lech.chuaXuatHoaDon === 2_000_000, thieuHd.lech)
    const rThieu = thieuHd.ruiRo.find(r => r.ma === 'chua-xuat-hoa-don')
    ok('có dựng rủi ro', !!rThieu)
    ok('… dẫn đúng căn cứ pháp lý', !!rThieu && /Điều 90|123\/2020/.test(rThieu.canCu), rThieu?.canCu)
    ok('… ước truy thu tính từ số thật, không bịa',
        !!rThieu?.uocTruyThu && rThieu.uocTruyThu > 0 && rThieu.uocTruyThu < 2_000_000, rThieu?.uocTruyThu)
    ok('… và liệt kê được chứng từ nào còn thiếu',
        thieuHd.chungTuChuaCoHoaDon.length === 2, thieuHd.chungTuChuaCoHoaDon.map(c => c.ma))

    console.log('\n▶ Hoá đơn huỷ / trả hàng — KHÔNG được tính thành xuất khống\n')

    const traHang = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000)],
        invoices: [
            hd('001', 1_000_000, { transactionId: 'T1' }),
            hd('002', 300_000, { invoiceType: 'RETURN' }),      // trả hàng → ghi ÂM
            hd('003', 5_000_000, { status: 'CANCELLED' }),      // đã huỷ → bỏ hẳn
        ],
    }), KY)
    ok('hoá đơn huỷ không được cộng vào doanh thu đã xuất',
        traHang.hoaDon.tongCoThue === 700_000, traHang.hoaDon.tongCoThue)
    ok('… và được đếm riêng ở mục huỷ', traHang.hoaDon.soHuy === 1)
    ok('hoá đơn trả hàng ghi âm, đếm riêng', traHang.hoaDon.soDieuChinh === 1)
    ok('KHÔNG kết luận "hoá đơn vượt sổ" dù có hoá đơn 5 triệu bị huỷ',
        !traHang.ruiRo.some(r => r.ma === 'hoa-don-vuot-so'), traHang.ruiRo.map(r => r.ma))

    console.log('\n▶ Hoá đơn nhiều hơn sổ — PHẢI báo, và đây là chiều nặng hơn\n')

    const vuot = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000)],
        invoices: [hd('001', 1_000_000, { transactionId: 'T1' }), hd('002', 4_000_000)],
    }), KY)
    const rVuot = vuot.ruiRo.find(r => r.ma === 'hoa-don-vuot-so')
    ok('bắt được chiều hoá đơn vượt sổ', !!rVuot && vuot.lech.hoaDonVuotSo === 4_000_000, vuot.lech)
    ok('xếp mức CAO', rVuot?.muc === 'cao', rVuot?.muc)

    /* Lệch vài đồng do làm tròn thì im — báo động vì tiền lẻ là cách nhanh nhất
     * để người dùng bỏ qua mọi cảnh báo về sau. */
    const leTien = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000)],
        invoices: [hd('001', 1_000_500, { transactionId: 'T1' })],
    }), KY)
    ok('lệch 500đ do làm tròn → KHÔNG báo động',
        !leTien.ruiRo.some(r => r.ma === 'hoa-don-vuot-so'), leTien.ruiRo.map(r => r.ma))

    console.log('\n▶ Dòng tiền — chưa nhập sao kê thì TUYỆT ĐỐI không suy diễn\n')

    const khongSaoKe = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 50_000_000)],
    }), KY)
    ok('không có giao dịch ngân hàng → không kết luận dòng tiền', !khongSaoKe.dongTien.duocKetLuan)
    ok('… và nói rõ đây KHÔNG phải dấu hiệu sai phạm',
        /KHÔNG phải dấu hiệu/.test(khongSaoKe.dongTien.lyDo || ''), khongSaoKe.dongTien.lyDo)
    ok('… không dựng rủi ro tiền vào chưa giải trình',
        !khongSaoKe.ruiRo.some(r => r.ma === 'tien-vao-chua-giai-trinh'))

    /* Tiền sàn quyết toán về là tiền vào ngân hàng HỢP LỆ. Nếu lib không trừ
     * phần này ra, mỗi lần Shopee/TikTok quyết toán là một lần báo động giả. */
    const coTienSan = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 10_000_000)],
        payments: [{ transactionId: 'T1', type: 'transfer', amount: 10_000_000 }],
        bank: [
            { id: 'B1', amount: 10_000_000, date: new Date('2026-07-10T10:00:00+07:00'), type: 'credit', description: 'khach CK' },
            { id: 'B2', amount: 30_000_000, date: new Date('2026-07-15T10:00:00+07:00'), type: 'credit', description: 'Shopee quyet toan' },
        ],
        journal: [{ date: '2026-07-15', referenceType: 'platform-settlement', amount: 30_000_000 }],
    }), KY)
    ok('tiền sàn quyết toán được coi là đã giải thích',
        coTienSan.dongTien.chuaGiaiThich === 0, coTienSan.dongTien)
    ok('… nên KHÔNG báo động giả', !coTienSan.ruiRo.some(r => r.ma === 'tien-vao-chua-giai-trinh'))

    const tienLa = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 10_000_000)],
        payments: [{ transactionId: 'T1', type: 'transfer', amount: 10_000_000 }],
        bank: [
            { id: 'B1', amount: 10_000_000, date: new Date('2026-07-10T10:00:00+07:00'), type: 'credit', description: 'khach CK' },
            { id: 'B2', amount: 90_000_000, date: new Date('2026-07-20T10:00:00+07:00'), type: 'credit', description: 'khong ro' },
        ],
    }), KY)
    const rTien = tienLa.ruiRo.find(r => r.ma === 'tien-vao-chua-giai-trinh')
    ok('tiền vào lạ → có báo', !!rTien && tienLa.dongTien.chuaGiaiThich === 90_000_000, tienLa.dongTien)
    ok('… nêu khả năng hợp lệ (vay, chuyển nội bộ) chứ không kết tội',
        !!rTien && /vay|chuyển nội bộ|hoàn/.test(rTien.vaSao), rTien?.vaSao)

    console.log(`\n▶ Chi tiền mặt từ ${NGUONG_TIEN_MAT / 1e6} triệu — mất khấu trừ\n`)

    const chiTienMat = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000)],
        expenses: [
            { id: 'C1', date: new Date('2026-07-05T10:00:00+07:00'), amount: 8_000_000, vatAmount: 640_000, supplierName: 'NCC A', invoiceNo: '000123', status: 'active', bankAccountId: null, description: 'mua hang' },
            { id: 'C2', date: new Date('2026-07-06T10:00:00+07:00'), amount: 9_000_000, vatAmount: 0, supplierName: 'NCC B', invoiceNo: '', status: 'active', bankAccountId: null, description: 'chi vat khong hoa don' },
        ],
    }), KY)
    ok('bắt khoản 8 triệu trả tiền mặt có hoá đơn', chiTienMat.chiTienMatLon.danhSach.length === 1, chiTienMat.chiTienMatLon.danhSach.map(c => c.id))
    ok('… tính đúng thuế GTGT bị mất', chiTienMat.chiTienMatLon.tongVatMat === 640_000, chiTienMat.chiTienMatLon.tongVatMat)
    ok('KHÔNG cảnh báo khoản không có hoá đơn (vốn đã không khấu trừ)',
        !chiTienMat.chiTienMatLon.danhSach.some(c => c.id === 'C2'))
    const rChi = chiTienMat.ruiRo.find(r => r.ma === 'chi-tien-mat-vuot-nguong')
    ok('… dẫn đúng luật GTGT 48/2024', !!rChi && /48\/2024/.test(rChi.canCu), rChi?.canCu)
    ok('… và nói rõ phần mềm SUY RA từ việc phiếu chi không gắn tài khoản',
        chiTienMat.ghiChu.some(g => /gắn tài khoản/.test(g)), chiTienMat.ghiChu)

    console.log('\n▶ Hoá đơn phát hành HỎNG — phải nói ra, không được im lặng bỏ qua\n')

    /* Tờ ERROR bị loại khỏi phần "đã xuất" là đúng (chưa có số, chưa gửi cơ quan
     * thuế), nhưng loại IM LẶNG thì cửa hàng thấy tỷ lệ phủ tụt mà không hiểu vì
     * sao rồi đi tìm nhầm chỗ. Thực tế 14/08/2026: một cửa hàng có 115 tờ hỏng,
     * trong đó 66 tờ THẬT RA đã phát hành thành công. */
    const coLoi = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 10_000_000)],
        invoices: [
            hd('001', 6_000_000, { transactionId: 'T1' }),
            hd('', 3_000_000, { status: 'ERROR' }),
            hd('', 1_000_000, { status: 'ERROR' }),
        ],
    }), KY)
    ok('đếm riêng số tờ hỏng', coLoi.hoaDon.soLoi === 2, coLoi.hoaDon.soLoi)
    ok('… và tổng tiền của chúng', coLoi.hoaDon.tienLoi === 4_000_000, coLoi.hoaDon.tienLoi)
    ok('KHÔNG cộng tờ hỏng vào phần đã xuất', coLoi.hoaDon.tongCoThue === 6_000_000, coLoi.hoaDon.tongCoThue)
    const rLoi = coLoi.ruiRo.find(r => r.ma === 'hoa-don-phat-hanh-loi')
    ok('có dựng cảnh báo riêng cho tờ hỏng', !!rLoi)
    ok('… nói rõ tỷ lệ phủ đang THẤP HƠN thực tế',
        coLoi.ghiChu.some(g => /THẤP HƠN thực tế/.test(g)), coLoi.ghiChu)
    ok('… và chỉ đúng cách xử lý tờ trùng khoá (ghi bù, không xuất lại)',
        !!rLoi && /ghi bù/.test(rLoi.canLam), rLoi?.canLam)
    ok('tờ hỏng KHÔNG bị gộp chung vào "chưa xuất hoá đơn" — hai việc chữa khác nhau',
        coLoi.ruiRo.filter(r => r.ma === 'hoa-don-phat-hanh-loi').length === 1)

    const sachKhongLoi = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000)],
        invoices: [hd('001', 1_000_000, { transactionId: 'T1' })],
    }), KY)
    ok('không có tờ hỏng → KHÔNG dựng cảnh báo thừa',
        !sachKhongLoi.ruiRo.some(r => r.ma === 'hoa-don-phat-hanh-loi') && sachKhongLoi.hoaDon.soLoi === 0)

    console.log('\n▶ Đọc hỏng bảng — KHÔNG được quy thành "cửa hàng không có"\n')

    const hongHd = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 100_000_000)],
        invoices: [hd('001', 100_000_000, { transactionId: 'T1' })],
    }, { eInvoice: true }), KY)
    ok('đọc hỏng bảng hoá đơn → không sập', !!hongHd.ky)
    ok('… ghi vào mục thiếu', hongHd.thieu.some(t => /eInvoice/.test(t)), hongHd.thieu)
    ok('… KHÔNG tố "còn 100 triệu chưa xuất hoá đơn"',
        !hongHd.ruiRo.some(r => r.ma === 'chua-xuat-hoa-don'), hongHd.ruiRo.map(r => r.ma))
    ok('… và ghi chú cảnh báo số đang để trống, không phải bằng 0',
        hongHd.ghiChu.some(g => /KHÔNG được hiểu là bằng không/.test(g)), hongHd.ghiChu)

    console.log('\n▶ Đơn sàn đẩy về quầy — không được đếm hai lần\n')

    /* Đơn sàn đồng bộ về sinh phiếu bán mang mã 'ONLINE-<mã đơn>' — đó là sợi
     * dây nối đích danh giữa hai nguồn. */
    const trungDon = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 5_000_000, '2026-07-10', { channel: 'online', receiptNumber: 'ONLINE-SPX1' })],
        onlineOrders: [{ id: 'O1', orderNumber: 'SPX1', total: 5_000_000, createdAt: new Date('2026-07-10T10:00:00+07:00'), status: 'delivered', platform: 'shopee' }],
    }), KY)
    ok('doanh thu sổ chỉ đếm một lần', trungDon.soSach.tong === 5_000_000, trungDon.soSach)
    ok('… và nói rõ đã gộp về một lần', trungDon.ghiChu.some(g => /MỘT lần/.test(g)), trungDon.ghiChu)

    /* CA GÂY SỰ CỐ THẬT (KENGISTORE, tháng 7/2026).
     *
     * Phiếu bán mang kênh 'online' nhưng đơn sàn tương ứng KHÔNG nằm trong tập
     * đang đếm (khác trạng thái, hoặc ngày tạo ngoài kỳ). Bản cũ trừ thẳng mọi
     * phiếu kênh 'online' nên 5 tỷ doanh thu biến mất, rồi kết luận NGƯỢC hoàn
     * toàn: báo "hoá đơn vượt sổ" trong khi thật ra còn cả đống doanh thu chưa
     * xuất hoá đơn. Doanh thu không được phép rơi mất chỉ vì gắn cờ kênh. */
    const sanKhongKhop = await doiChieuBaChieu(fakePrisma({
        transactions: [
            gd(1, 3_000_000_000, '2026-07-10', { channel: 'online', receiptNumber: 'ONLINE-A1' }),
            gd(2, 2_000_000_000, '2026-07-11', { channel: 'online', receiptNumber: 'ONLINE-A2' }),
        ],
        // Đơn sàn ở trạng thái không được đếm → không nối được với phiếu nào
        onlineOrders: [{ id: 'O9', orderNumber: 'B9', total: 1_000, createdAt: new Date('2026-07-10T10:00:00+07:00'), status: 'shipping', platform: 'shopee' }],
        invoices: [hd('001', 700_000_000, { transactionId: 'T1' })],
    }), KY)
    ok('phiếu kênh online không nối được đơn sàn → VẪN tính đủ vào sổ',
        sanKhongKhop.soSach.tong === 5_000_000_000, sanKhongKhop.soSach)
    ok('… nên kết luận đúng chiều: còn doanh thu CHƯA xuất hoá đơn',
        sanKhongKhop.lech.chuaXuatHoaDon === 4_300_000_000 && sanKhongKhop.lech.hoaDonVuotSo === 0,
        sanKhongKhop.lech)
    ok('… và KHÔNG tố ngược "hoá đơn vượt sổ"',
        !sanKhongKhop.ruiRo.some(r => r.ma === 'hoa-don-vuot-so'), sanKhongKhop.ruiRo.map(r => r.ma))

    /* Bảng lệch theo ngày phải đếm CÙNG một tập với tổng — hai chỗ đếm khác nhau
     * thì người dùng không biết tin con số nào. */
    const tongTheoNgay = sanKhongKhop.theoNgay.reduce((s, n) => s + n.soSach, 0)
    ok('bảng theo ngày cộng lại đúng bằng tổng sổ',
        tongTheoNgay === sanKhongKhop.soSach.tong, [tongTheoNgay, sanKhongKhop.soSach.tong])

    console.log('\n▶ Chưa dùng hoá đơn điện tử — cảnh báo về DỮ LIỆU, không phải kết tội\n')

    const khongHd = await doiChieuBaChieu(fakePrisma({ transactions: [gd(1, 20_000_000)] }), KY)
    const rKhong = khongHd.ruiRo.find(r => r.ma === 'khong-co-hoa-don-nao')
    ok('có nhắc nhở', !!rKhong)
    ok('… nói rõ đây là cảnh báo về dữ liệu', !!rKhong && /DỮ LIỆU/.test(rKhong.vaSao), rKhong?.vaSao)
    ok('… KHÔNG đồng thời tố "chưa xuất hoá đơn" bằng số rỗng',
        !khongHd.ruiRo.some(r => r.ma === 'chua-xuat-hoa-don'), khongHd.ruiRo.map(r => r.ma))

    console.log('\n▶ Lệch theo ngày — để truy về đúng ngày\n')

    const theoNgay = await doiChieuBaChieu(fakePrisma({
        transactions: [gd(1, 1_000_000, '2026-07-05'), gd(2, 2_000_000, '2026-07-06')],
        invoices: [hd('001', 1_000_000, { invoiceDate: '2026-07-05', transactionId: 'T1' })],
    }), KY)
    ok('có bảng lệch theo ngày', theoNgay.theoNgay.length === 2)
    ok('ngày 06 lệch đúng 2 triệu',
        theoNgay.theoNgay.find(n => n.ngay === '2026-07-06')?.lech === 2_000_000,
        theoNgay.theoNgay)
    ok('ngày 05 không lệch', theoNgay.theoNgay.find(n => n.ngay === '2026-07-05')?.lech === 0)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
