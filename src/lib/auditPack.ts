/**
 * BỘ HỒ SƠ THANH TRA + TRUY VẾT CHỨNG TỪ — hàm thuần, chạy được với client giả.
 *
 * Khi có quyết định thanh tra/kiểm tra thuế, đoàn không hỏi "cho xem phần mềm"
 * mà đưa một danh sách sổ sách phải nộp bản in kèm file mềm. Module này dựng
 * đúng danh sách đó từ dữ liệu đang có, và nói thẳng cái nào KHÔNG dựng được
 * (phải lấy bản giấy) thay vì im lặng bỏ qua — chỗ thiếu mới là chỗ chết người.
 *
 * Phần thứ hai là truy vết: đoàn chọn ngẫu nhiên một số hóa đơn rồi bắt đi hết
 * đường đi của nó — chứng từ gốc → xuất kho → hóa đơn → bút toán → thu tiền →
 * kỳ kê khai. Đứt ở đâu là bị soi ở đó. Hàm truyVetChungTu() đi đúng chuỗi ấy.
 *
 * Nguyên tắc:
 *  1. Mỗi tài liệu ghi rõ MẪU SỔ và CĂN CỨ — để in ra nộp được, không phải bảng
 *     tự chế.
 *  2. Một tài liệu dựng lỗi thì đánh dấu thiếu, KHÔNG làm hỏng cả bộ.
 *  3. Truy vết chỉ nói "thiếu" khi chắc chắn thiếu; chỗ không đủ dữ liệu để kết
 *     luận thì ghi "không kiểm được", vì báo bừa làm kế toán mất niềm tin.
 */

export type KieuCot = 'tien' | 'so' | 'ngay' | 'chu'

export interface CotBang {
    khoa: string
    nhan: string
    kieu?: KieuCot
}

export interface TaiLieuThanhTra {
    ma: string
    ten: string
    /** Mẫu sổ theo TT 133/2016/TT-BTC hoặc mẫu tờ khai, ghi để in ra nộp được */
    mau: string
    canCu: string
    /** Đoàn thanh tra dùng tài liệu này để làm gì — giúp kế toán hiểu vì sao phải có */
    vaiTro: string
    cot: CotBang[]
    dong: Record<string, any>[]
    /** Dòng tổng cộng cuối bảng (theo khóa cột) */
    tong: Record<string, number>
    ghiChu?: string
}

export interface TaiLieuThieu {
    ma: string
    ten: string
    lyDo: string
    /** Lấy ở đâu ra khi đoàn hỏi */
    layTuDau: string
}

export interface BoHoSoThanhTra {
    ky: { from: string; to: string; nhan: string }
    taiLieu: TaiLieuThanhTra[]
    thieu: TaiLieuThieu[]
    tongQuan: {
        soTaiLieu: number
        soDong: number
        soTaiLieuTrong: number
    }
}

const r0 = (v: number) => Math.round(v || 0)
const ngayISO = (d: Date) => d.toISOString().slice(0, 10)

/** Ngày của bản ghi, ưu tiên ngày nghiệp vụ hơn ngày tạo bản ghi */
function ngayCua(x: any, ...truong: string[]): string {
    for (const t of truong) {
        const v = x?.[t]
        if (!v) continue
        if (typeof v === 'string') return v.slice(0, 10)
        if (v instanceof Date) return ngayISO(v)
        const d = new Date(v)
        if (!isNaN(d.getTime())) return ngayISO(d)
    }
    return ''
}

function congTong(dong: Record<string, any>[], cot: CotBang[]): Record<string, number> {
    const tong: Record<string, number> = {}
    for (const c of cot) {
        if (c.kieu !== 'tien' && c.kieu !== 'so') continue
        tong[c.khoa] = r0(dong.reduce((s, d) => s + (Number(d[c.khoa]) || 0), 0))
    }
    return tong
}

function dungTaiLieu(
    t: Omit<TaiLieuThanhTra, 'tong'> & { tong?: Record<string, number> },
): TaiLieuThanhTra {
    return { ...t, tong: t.tong ?? congTong(t.dong, t.cot) }
}

/* ────────────────────────────────────────────────────────────────────────────
 * BỘ HỒ SƠ
 * ──────────────────────────────────────────────────────────────────────────── */

export async function boHoSoThanhTra(
    prisma: any,
    ky: { from: string; to: string; nhan?: string },
): Promise<BoHoSoThanhTra> {
    const { from, to } = ky
    const start = new Date(from + 'T00:00:00.000Z')
    const end = new Date(to + 'T23:59:59.999Z')

    const taiLieu: TaiLieuThanhTra[] = []
    const thieu: TaiLieuThieu[] = []

    /* Mỗi tài liệu dựng trong một vỏ bọc riêng: hỏng một cái thì ghi vào danh
     * sách thiếu chứ không làm sập cả bộ. Đoàn thanh tra vẫn nhận được 12 tài
     * liệu còn lại thay vì một trang lỗi. */
    const them = async (
        ma: string,
        ten: string,
        layTuDau: string,
        fn: () => Promise<TaiLieuThanhTra | null>,
    ) => {
        try {
            const t = await fn()
            if (t) taiLieu.push(t)
            else thieu.push({ ma, ten, lyDo: 'Kỳ này không có số liệu', layTuDau })
        } catch (e: any) {
            thieu.push({
                ma, ten,
                lyDo: 'Không dựng được từ dữ liệu: ' + String(e?.message || e).slice(0, 120),
                layTuDau,
            })
        }
    }

    // ── 01. Bảng kê hóa đơn bán ra ───────────────────────────────────────────
    await them('01-hd-ban-ra', 'Bảng kê hóa đơn, chứng từ hàng hóa dịch vụ bán ra',
        'Sổ hóa đơn điện tử trên cổng hoadondientu.gdt.gov.vn', async () => {
            const hds = await prisma.eInvoice.findMany({
                where: { invoiceDate: { gte: from, lte: to } },
                select: {
                    invoiceSymbol: true, invoiceNumber: true, invoiceDate: true, invoiceType: true,
                    status: true, buyerName: true, buyerTaxCode: true, paymentMethod: true,
                    totalBeforeVat: true, vatAmount: true, totalAmount: true, lookupCode: true,
                },
            })
            if (!hds?.length) return null
            const cot: CotBang[] = [
                { khoa: 'kyHieu', nhan: 'Ký hiệu' },
                { khoa: 'soHd', nhan: 'Số hóa đơn' },
                { khoa: 'ngay', nhan: 'Ngày lập', kieu: 'ngay' },
                { khoa: 'loai', nhan: 'Loại' },
                { khoa: 'trangThai', nhan: 'Trạng thái' },
                { khoa: 'nguoiMua', nhan: 'Tên người mua' },
                { khoa: 'mstMua', nhan: 'MST người mua' },
                { khoa: 'httt', nhan: 'HT thanh toán' },
                { khoa: 'truocThue', nhan: 'Doanh thu chưa thuế', kieu: 'tien' },
                { khoa: 'thue', nhan: 'Thuế GTGT', kieu: 'tien' },
                { khoa: 'tong', nhan: 'Tổng thanh toán', kieu: 'tien' },
                { khoa: 'maTraCuu', nhan: 'Mã tra cứu' },
            ]
            const dong = hds
                .sort((a: any, b: any) =>
                    (a.invoiceDate || '').localeCompare(b.invoiceDate || '') ||
                    Number(a.invoiceNumber || 0) - Number(b.invoiceNumber || 0))
                .map((h: any) => {
                    /* Hóa đơn đã hủy vẫn PHẢI có trong bảng kê — đoàn đối chiếu dải số
                     * liên tục, thiếu một số là bị hỏi ngay. Nhưng tiền phải để 0 để
                     * không cộng vào doanh thu. */
                    const huy = h.status === 'CANCELLED'
                    return {
                        kyHieu: h.invoiceSymbol || '',
                        soHd: h.invoiceNumber || '',
                        ngay: h.invoiceDate || '',
                        loai: h.invoiceType === 'RETURN' ? 'Trả lại'
                            : h.invoiceType === 'ADJUSTMENT' ? 'Điều chỉnh' : 'Bán ra',
                        trangThai: huy ? 'ĐÃ HỦY' : h.status || '',
                        nguoiMua: h.buyerName || 'Khách lẻ',
                        mstMua: h.buyerTaxCode || '',
                        httt: h.paymentMethod || '',
                        truocThue: huy ? 0 : r0(h.totalBeforeVat),
                        thue: huy ? 0 : r0(h.vatAmount),
                        tong: huy ? 0 : r0(h.totalAmount),
                        maTraCuu: h.lookupCode || '',
                    }
                })
            return dungTaiLieu({
                ma: '01-hd-ban-ra',
                ten: 'Bảng kê hóa đơn, chứng từ hàng hóa dịch vụ bán ra',
                mau: 'Mẫu 01-1/GTGT',
                canCu: 'Nghị định 123/2020/NĐ-CP; Thông tư 78/2021/TT-BTC',
                vaiTro: 'Đối chiếu doanh thu kê khai với hóa đơn đã phát hành; soi dải số hóa đơn có liên tục không.',
                cot, dong,
                ghiChu: 'Hóa đơn đã hủy vẫn liệt kê để dải số liên tục, nhưng ghi tiền = 0.',
            })
        })

    // ── 02. Bảng kê hóa đơn mua vào ──────────────────────────────────────────
    await them('02-hd-mua-vao', 'Bảng kê hóa đơn, chứng từ hàng hóa dịch vụ mua vào',
        'Hóa đơn đầu vào bản giấy/PDF của nhà cung cấp', async () => {
            const nhap = await prisma.importReceipt.findMany({
                where: { status: 'completed', createdAt: { gte: start, lte: end } },
                select: {
                    code: true, vatInvoiceNo: true, hasVatInvoice: true, supplierName: true,
                    totalCost: true, vatAmount: true, transactionDate: true, createdAt: true,
                },
            })
            const chi = await prisma.expense.findMany({
                where: { date: { gte: start, lte: end } },
                select: {
                    description: true, amount: true, vatAmount: true, invoiceNo: true,
                    invoiceSymbol: true, invoiceDate: true, supplierName: true,
                    supplierTaxCode: true, status: true, date: true,
                },
            })
            const cot: CotBang[] = [
                { khoa: 'kyHieu', nhan: 'Ký hiệu' },
                { khoa: 'soHd', nhan: 'Số hóa đơn' },
                { khoa: 'ngay', nhan: 'Ngày hóa đơn', kieu: 'ngay' },
                { khoa: 'nguoiBan', nhan: 'Tên người bán' },
                { khoa: 'mstBan', nhan: 'MST người bán' },
                { khoa: 'noiDung', nhan: 'Nội dung' },
                { khoa: 'truocThue', nhan: 'Giá trị chưa thuế', kieu: 'tien' },
                { khoa: 'thue', nhan: 'Thuế GTGT', kieu: 'tien' },
                { khoa: 'khauTru', nhan: 'Được khấu trừ' },
            ]
            const dong: Record<string, any>[] = []
            for (const n of nhap || []) {
                const vat = r0(n.vatAmount)
                dong.push({
                    kyHieu: '',
                    soHd: n.vatInvoiceNo || (n.hasVatInvoice ? '(chưa nhập số)' : 'KHÔNG CÓ HĐ'),
                    ngay: ngayCua(n, 'transactionDate', 'createdAt'),
                    nguoiBan: n.supplierName || '',
                    mstBan: '',
                    noiDung: 'Nhập hàng ' + (n.code || ''),
                    truocThue: r0(n.totalCost) - vat,
                    thue: vat,
                    khauTru: n.hasVatInvoice ? 'Có' : 'Không',
                })
            }
            for (const c of chi || []) {
                if (c.status === 'cancelled') continue
                const vat = r0(c.vatAmount)
                dong.push({
                    kyHieu: c.invoiceSymbol || '',
                    soHd: c.invoiceNo || 'KHÔNG CÓ HĐ',
                    ngay: ngayCua(c, 'invoiceDate', 'date'),
                    nguoiBan: c.supplierName || '',
                    mstBan: c.supplierTaxCode || '',
                    noiDung: c.description || '',
                    truocThue: r0(c.amount) - vat,
                    thue: vat,
                    khauTru: c.invoiceNo ? 'Có' : 'Không',
                })
            }
            if (!dong.length) return null
            dong.sort((a, b) => String(a.ngay).localeCompare(String(b.ngay)))
            return dungTaiLieu({
                ma: '02-hd-mua-vao',
                ten: 'Bảng kê hóa đơn, chứng từ hàng hóa dịch vụ mua vào',
                mau: 'Mẫu 01-2/GTGT',
                canCu: 'Điều 15 Thông tư 219/2013/TT-BTC; Luật Thuế GTGT 48/2024',
                vaiTro: 'Chứng minh thuế GTGT đầu vào được khấu trừ; đoàn soi kỹ dòng ghi "KHÔNG CÓ HĐ".',
                cot, dong,
                ghiChu: 'Dòng ghi KHÔNG CÓ HĐ là khoản không đủ điều kiện khấu trừ và có nguy cơ bị loại khi tính thuế TNDN.',
            })
        })

    // ── 03. Sổ nhật ký chung ─────────────────────────────────────────────────
    const butToan: any[] = await prisma.journalEntry.findMany({
        where: { date: { gte: from, lte: to } },
        select: {
            date: true, description: true, debitAccount: true, debitAccountName: true,
            creditAccount: true, creditAccountName: true, amount: true,
            reference: true, referenceType: true,
        },
    }).catch(() => [])
    const butToanSap = [...(butToan || [])].sort((a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        String(a.reference || '').localeCompare(String(b.reference || '')))

    await them('03-nhat-ky-chung', 'Sổ nhật ký chung',
        'Sổ kế toán tổng hợp — bắt buộc phải có', async () => {
            if (!butToanSap.length) return null
            const cot: CotBang[] = [
                { khoa: 'ngay', nhan: 'Ngày ghi sổ', kieu: 'ngay' },
                { khoa: 'soCt', nhan: 'Số chứng từ' },
                { khoa: 'dienGiai', nhan: 'Diễn giải' },
                { khoa: 'tkNo', nhan: 'TK Nợ' },
                { khoa: 'tkCo', nhan: 'TK Có' },
                { khoa: 'soTien', nhan: 'Số tiền', kieu: 'tien' },
            ]
            return dungTaiLieu({
                ma: '03-nhat-ky-chung',
                ten: 'Sổ nhật ký chung',
                mau: 'Mẫu S03a-DNN',
                canCu: 'Thông tư 133/2016/TT-BTC',
                vaiTro: 'Sổ gốc của toàn bộ nghiệp vụ; đoàn dò từ đây xuống sổ cái và ngược lên chứng từ.',
                cot,
                dong: butToanSap.map(b => ({
                    ngay: b.date,
                    soCt: b.reference || '',
                    dienGiai: b.description || '',
                    tkNo: b.debitAccount,
                    tkCo: b.creditAccount,
                    soTien: r0(b.amount),
                })),
            })
        })

    // ── 04. Sổ cái tổng hợp ──────────────────────────────────────────────────
    await them('04-so-cai', 'Sổ cái các tài khoản (tổng hợp phát sinh)',
        'Sổ kế toán tổng hợp', async () => {
            if (!butToanSap.length) return null
            const truoc: any[] = await prisma.journalEntry.findMany({
                where: { date: { lt: from } },
                select: { debitAccount: true, creditAccount: true, amount: true },
            }).catch(() => null) || []
            const map = new Map<string, { ten: string; duNo: number; duCo: number; psNo: number; psCo: number }>()
            const lay = (tk: string, ten?: string) => {
                if (!map.has(tk)) map.set(tk, { ten: ten || '', duNo: 0, duCo: 0, psNo: 0, psCo: 0 })
                const o = map.get(tk)!
                if (ten && !o.ten) o.ten = ten
                return o
            }
            for (const b of truoc) {
                lay(b.debitAccount).duNo += b.amount
                lay(b.creditAccount).duCo += b.amount
            }
            for (const b of butToanSap) {
                lay(b.debitAccount, b.debitAccountName).psNo += b.amount
                lay(b.creditAccount, b.creditAccountName).psCo += b.amount
            }
            const cot: CotBang[] = [
                { khoa: 'tk', nhan: 'Tài khoản' },
                { khoa: 'ten', nhan: 'Tên tài khoản' },
                { khoa: 'dauNo', nhan: 'Dư đầu kỳ Nợ', kieu: 'tien' },
                { khoa: 'dauCo', nhan: 'Dư đầu kỳ Có', kieu: 'tien' },
                { khoa: 'psNo', nhan: 'PS trong kỳ Nợ', kieu: 'tien' },
                { khoa: 'psCo', nhan: 'PS trong kỳ Có', kieu: 'tien' },
                { khoa: 'cuoiNo', nhan: 'Dư cuối kỳ Nợ', kieu: 'tien' },
                { khoa: 'cuoiCo', nhan: 'Dư cuối kỳ Có', kieu: 'tien' },
            ]
            const dong = [...map.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([tk, o]) => {
                    /* Số dư trình bày một bên: chênh dương thì để cột Nợ, âm để cột Có.
                     * Trình bày cả hai bên cùng lúc là lỗi kinh điển khi in sổ cái. */
                    const dau = o.duNo - o.duCo
                    const cuoi = dau + o.psNo - o.psCo
                    return {
                        tk, ten: o.ten,
                        dauNo: dau > 0 ? r0(dau) : 0,
                        dauCo: dau < 0 ? r0(-dau) : 0,
                        psNo: r0(o.psNo),
                        psCo: r0(o.psCo),
                        cuoiNo: cuoi > 0 ? r0(cuoi) : 0,
                        cuoiCo: cuoi < 0 ? r0(-cuoi) : 0,
                    }
                })
            return dungTaiLieu({
                ma: '04-so-cai',
                ten: 'Sổ cái các tài khoản (tổng hợp phát sinh)',
                mau: 'Mẫu S03b-DNN',
                canCu: 'Thông tư 133/2016/TT-BTC',
                vaiTro: 'Bảng cân đối phát sinh rút gọn — tổng PS Nợ phải bằng tổng PS Có, lệch là sổ sai.',
                cot, dong,
            })
        })

    // ── 05 & 06. Sổ quỹ tiền mặt / sổ tiền gửi ───────────────────────────────
    const soTien = (tienTo: '111' | '112', ma: string, ten: string, mau: string) =>
        them(ma, ten, 'Sổ quỹ / sao kê ngân hàng', async () => {
            const truoc: any[] = await prisma.journalEntry.findMany({
                where: { date: { lt: from } },
                select: { debitAccount: true, creditAccount: true, amount: true },
            }).catch(() => null) || []
            let duDau = 0
            for (const b of truoc) {
                if (String(b.debitAccount || '').startsWith(tienTo)) duDau += b.amount
                if (String(b.creditAccount || '').startsWith(tienTo)) duDau -= b.amount
            }
            const lienQuan = butToanSap.filter(b =>
                String(b.debitAccount || '').startsWith(tienTo) ||
                String(b.creditAccount || '').startsWith(tienTo))
            if (!lienQuan.length && !duDau) return null
            const cot: CotBang[] = [
                { khoa: 'ngay', nhan: 'Ngày', kieu: 'ngay' },
                { khoa: 'soCt', nhan: 'Số chứng từ' },
                { khoa: 'dienGiai', nhan: 'Diễn giải' },
                { khoa: 'tkDoiUng', nhan: 'TK đối ứng' },
                { khoa: 'thu', nhan: 'Thu', kieu: 'tien' },
                { khoa: 'chi', nhan: 'Chi', kieu: 'tien' },
                { khoa: 'ton', nhan: 'Tồn', kieu: 'so' },
            ]
            let ton = duDau
            const dong: Record<string, any>[] = [{
                ngay: from, soCt: '', dienGiai: 'Số dư đầu kỳ', tkDoiUng: '',
                thu: 0, chi: 0, ton: r0(duDau),
            }]
            for (const b of lienQuan) {
                const thu = String(b.debitAccount || '').startsWith(tienTo) ? b.amount : 0
                const chi = String(b.creditAccount || '').startsWith(tienTo) ? b.amount : 0
                ton += thu - chi
                dong.push({
                    ngay: b.date,
                    soCt: b.reference || '',
                    dienGiai: b.description || '',
                    tkDoiUng: thu ? b.creditAccount : b.debitAccount,
                    thu: r0(thu), chi: r0(chi), ton: r0(ton),
                })
            }
            /* Cột tồn là số dư lũy kế, cộng dồn nó vô nghĩa — tổng phải là tồn cuối. */
            const tong = congTong(dong, cot)
            tong.ton = r0(ton)
            return dungTaiLieu({
                ma, ten, mau,
                canCu: 'Thông tư 133/2016/TT-BTC',
                vaiTro: tienTo === '111'
                    ? 'Đoàn soi tồn quỹ có ngày nào ÂM không — quỹ âm là bằng chứng bỏ sót doanh thu hoặc chứng từ khống.'
                    : 'Đối chiếu với sao kê ngân hàng; lệch là phải giải trình từng khoản.',
                cot, dong, tong,
                ghiChu: 'Số dư đầu kỳ tính từ toàn bộ bút toán trước ngày ' + from + '.',
            })
        })
    await soTien('111', '05-so-quy-tien-mat', 'Sổ quỹ tiền mặt', 'Mẫu S05-DNN')
    await soTien('112', '06-so-tien-gui', 'Sổ tiền gửi ngân hàng', 'Mẫu S06-DNN')

    // ── 07 & 08. Công nợ phải thu / phải trả ─────────────────────────────────
    await them('07-cong-no-phai-thu', 'Sổ chi tiết công nợ phải thu (TK 131)',
        'Biên bản đối chiếu công nợ với khách hàng', async () => {
            const kh = await prisma.customer.findMany({
                where: { debt: { not: 0 } },
                select: { code: true, name: true, phone: true, debt: true, lastPurchaseDate: true },
            })
            if (!kh?.length) return null
            const cot: CotBang[] = [
                { khoa: 'ma', nhan: 'Mã KH' },
                { khoa: 'ten', nhan: 'Tên khách hàng' },
                { khoa: 'dienThoai', nhan: 'Điện thoại' },
                { khoa: 'muaCuoi', nhan: 'Mua gần nhất', kieu: 'ngay' },
                { khoa: 'duNo', nhan: 'Số dư Nợ', kieu: 'tien' },
            ]
            return dungTaiLieu({
                ma: '07-cong-no-phai-thu',
                ten: 'Sổ chi tiết công nợ phải thu (TK 131)',
                mau: 'Mẫu S13-DNN',
                canCu: 'Thông tư 133/2016/TT-BTC',
                vaiTro: 'Tổng số dư phải khớp dư Nợ 131 trên sổ cái; đoàn có quyền gửi xác nhận công nợ tới khách.',
                cot,
                dong: kh
                    .sort((a: any, b: any) => (b.debt || 0) - (a.debt || 0))
                    .map((c: any) => ({
                        ma: c.code, ten: c.name, dienThoai: c.phone || '',
                        muaCuoi: ngayCua(c, 'lastPurchaseDate'),
                        duNo: r0(c.debt),
                    })),
                ghiChu: 'Số dư lấy tại thời điểm xuất, không phải số dư cuối kỳ lịch sử.',
            })
        })

    await them('08-cong-no-phai-tra', 'Sổ chi tiết công nợ phải trả (TK 331)',
        'Biên bản đối chiếu công nợ với nhà cung cấp', async () => {
            const nhap = await prisma.importReceipt.findMany({
                where: { status: 'completed', paymentStatus: { in: ['unpaid', 'partial'] } },
                select: {
                    code: true, supplierName: true, totalCost: true, paidAmount: true,
                    dueDate: true, transactionDate: true, createdAt: true,
                },
            })
            if (!nhap?.length) return null
            const cot: CotBang[] = [
                { khoa: 'maPhieu', nhan: 'Số phiếu nhập' },
                { khoa: 'ngay', nhan: 'Ngày nhập', kieu: 'ngay' },
                { khoa: 'ncc', nhan: 'Nhà cung cấp' },
                { khoa: 'phaiTra', nhan: 'Phải trả', kieu: 'tien' },
                { khoa: 'daTra', nhan: 'Đã trả', kieu: 'tien' },
                { khoa: 'conNo', nhan: 'Còn nợ', kieu: 'tien' },
                { khoa: 'hanTra', nhan: 'Hạn trả', kieu: 'ngay' },
            ]
            return dungTaiLieu({
                ma: '08-cong-no-phai-tra',
                ten: 'Sổ chi tiết công nợ phải trả (TK 331)',
                mau: 'Mẫu S14-DNN',
                canCu: 'Thông tư 133/2016/TT-BTC',
                vaiTro: 'Tổng còn nợ phải khớp dư Có 331; khoản treo quá lâu bị hỏi có phải nợ khống không.',
                cot,
                dong: nhap.map((n: any) => ({
                    maPhieu: n.code,
                    ngay: ngayCua(n, 'transactionDate', 'createdAt'),
                    ncc: n.supplierName || '',
                    phaiTra: r0(n.totalCost),
                    daTra: r0(n.paidAmount),
                    conNo: r0((n.totalCost || 0) - (n.paidAmount || 0)),
                    hanTra: ngayCua(n, 'dueDate'),
                })),
            })
        })

    // ── 09. Bảng nhập xuất tồn ───────────────────────────────────────────────
    await them('09-nhap-xuat-ton', 'Bảng tổng hợp nhập - xuất - tồn kho',
        'Biên bản kiểm kê kho có chữ ký', async () => {
            const nhapKy = await prisma.importReceiptItem.findMany({
                where: { receipt: { status: 'completed', createdAt: { gte: start, lte: end } } },
                select: { productId: true, productName: true, productSku: true, quantity: true, total: true },
            })
            const xuatKy = await prisma.transactionItem.findMany({
                where: { transaction: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } } },
                select: { productId: true, productName: true, sku: true, quantity: true, lineTotal: true },
            })
            if (!nhapKy?.length && !xuatKy?.length) return null
            type Dong = { sku: string; ten: string; slNhap: number; tienNhap: number; slXuat: number; tienXuat: number }
            const map = new Map<string, Dong>()
            const lay = (id: string, sku: string, ten: string) => {
                if (!map.has(id)) map.set(id, { sku, ten, slNhap: 0, tienNhap: 0, slXuat: 0, tienXuat: 0 })
                return map.get(id)!
            }
            for (const n of nhapKy || []) {
                const o = lay(n.productId, n.productSku || '', n.productName || '')
                o.slNhap += n.quantity || 0
                o.tienNhap += n.total || 0
            }
            for (const x of xuatKy || []) {
                const o = lay(x.productId, x.sku || '', x.productName || '')
                o.slXuat += x.quantity || 0
                o.tienXuat += x.lineTotal || 0
            }
            const ids = [...map.keys()]
            const sp = await prisma.product.findMany({
                where: { id: { in: ids } },
                select: { id: true, stock: true, costPrice: true, baseUnit: true },
            }).catch(() => [])
            const spMap = new Map((sp || []).map((p: any) => [p.id, p]))
            const cot: CotBang[] = [
                { khoa: 'sku', nhan: 'Mã hàng' },
                { khoa: 'ten', nhan: 'Tên hàng' },
                { khoa: 'dvt', nhan: 'ĐVT' },
                { khoa: 'slNhap', nhan: 'SL nhập', kieu: 'so' },
                { khoa: 'tienNhap', nhan: 'Giá trị nhập', kieu: 'tien' },
                { khoa: 'slXuat', nhan: 'SL xuất', kieu: 'so' },
                { khoa: 'tienXuat', nhan: 'Doanh thu xuất', kieu: 'tien' },
                { khoa: 'tonCuoi', nhan: 'Tồn hiện tại', kieu: 'so' },
                { khoa: 'giaTriTon', nhan: 'Giá trị tồn', kieu: 'tien' },
            ]
            const dong = [...map.entries()]
                .map(([id, o]) => {
                    const p: any = spMap.get(id)
                    const ton = p?.stock ?? 0
                    return {
                        sku: o.sku, ten: o.ten, dvt: p?.baseUnit || '',
                        slNhap: o.slNhap, tienNhap: r0(o.tienNhap),
                        slXuat: o.slXuat, tienXuat: r0(o.tienXuat),
                        tonCuoi: ton, giaTriTon: r0(ton * (p?.costPrice || 0)),
                    }
                })
                .sort((a, b) => b.tienXuat - a.tienXuat)
            return dungTaiLieu({
                ma: '09-nhap-xuat-ton',
                ten: 'Bảng tổng hợp nhập - xuất - tồn kho',
                mau: 'Mẫu S11-DNN',
                canCu: 'Thông tư 133/2016/TT-BTC',
                vaiTro: 'Đoàn kiểm tra hàng bán ra có tương ứng hàng mua vào không; xuất nhiều hơn nhập là dấu hiệu mua hàng không hóa đơn.',
                cot, dong,
                ghiChu: 'Cột tồn là tồn TẠI THỜI ĐIỂM XUẤT bảng, không phải tồn cuối kỳ lịch sử — kiểm kê thực tế mới là căn cứ.',
            })
        })

    // ── 10. Bảng lương ───────────────────────────────────────────────────────
    await them('10-bang-luong', 'Bảng thanh toán tiền lương và thuế TNCN khấu trừ',
        'Bảng lương có chữ ký nhận + hợp đồng lao động', async () => {
            const y1 = Number(from.slice(0, 4)), m1 = Number(from.slice(5, 7))
            const y2 = Number(to.slice(0, 4)), m2 = Number(to.slice(5, 7))
            const kyLuong = await prisma.payrollPeriod.findMany({
                select: { id: true, month: true, year: true, status: true },
            })
            const trongKy = (kyLuong || []).filter((k: any) => {
                const v = k.year * 12 + k.month
                return v >= y1 * 12 + m1 && v <= y2 * 12 + m2
            })
            if (!trongKy.length) return null
            const dongLuong = await prisma.payrollEntry.findMany({
                where: { periodId: { in: trongKy.map((k: any) => k.id) } },
                select: {
                    periodId: true, employeeCode: true, employeeName: true, workDays: true,
                    baseSalary: true, allowances: true, grossSalary: true,
                    totalInsuranceEmployee: true, pitAmount: true, netSalary: true,
                },
            })
            if (!dongLuong?.length) return null
            const kyMap = new Map(trongKy.map((k: any) => [k.id, `${String(k.month).padStart(2, '0')}/${k.year}`]))
            const cot: CotBang[] = [
                { khoa: 'ky', nhan: 'Kỳ lương' },
                { khoa: 'maNv', nhan: 'Mã NV' },
                { khoa: 'ten', nhan: 'Họ tên' },
                { khoa: 'cong', nhan: 'Ngày công', kieu: 'so' },
                { khoa: 'luongCb', nhan: 'Lương cơ bản', kieu: 'tien' },
                { khoa: 'phuCap', nhan: 'Phụ cấp', kieu: 'tien' },
                { khoa: 'tongThuNhap', nhan: 'Tổng thu nhập', kieu: 'tien' },
                { khoa: 'bhNv', nhan: 'BH người LĐ trừ', kieu: 'tien' },
                { khoa: 'tncn', nhan: 'TNCN khấu trừ', kieu: 'tien' },
                { khoa: 'thucLinh', nhan: 'Thực lĩnh', kieu: 'tien' },
            ]
            return dungTaiLieu({
                ma: '10-bang-luong',
                ten: 'Bảng thanh toán tiền lương và thuế TNCN khấu trừ',
                mau: 'Mẫu S12-DNN / Phụ lục 05-1/BK-QTT-TNCN',
                canCu: 'Thông tư 111/2013/TT-BTC; Điều 4 Thông tư 96/2015/TT-BTC',
                vaiTro: 'Chi phí lương chỉ được trừ khi có bảng lương + hợp đồng + chứng từ chi; đoàn cũng soát TNCN khấu trừ đủ chưa.',
                cot,
                dong: (dongLuong || []).map((e: any) => ({
                    ky: kyMap.get(e.periodId) || '',
                    maNv: e.employeeCode || '',
                    ten: e.employeeName || '',
                    cong: e.workDays || 0,
                    luongCb: r0(e.baseSalary),
                    phuCap: r0(e.allowances),
                    tongThuNhap: r0(e.grossSalary),
                    bhNv: r0(e.totalInsuranceEmployee),
                    tncn: r0(e.pitAmount),
                    thucLinh: r0(e.netSalary),
                })),
            })
        })

    // ── 11. Khấu hao TSCĐ ────────────────────────────────────────────────────
    await them('11-khau-hao-tscd', 'Bảng tính và phân bổ khấu hao tài sản cố định',
        'Hồ sơ TSCĐ: hóa đơn mua, biên bản bàn giao', async () => {
            const ts = await prisma.fixedAsset.findMany({
                where: { status: { not: 'disposed' } },
                select: {
                    code: true, name: true, acquisitionDate: true, originalCost: true,
                    usefulLifeMonths: true, monthlyDepreciation: true,
                    accumulatedDepreciation: true, netBookValue: true, expenseAccountCode: true,
                },
            })
            if (!ts?.length) return null
            const soThang = (() => {
                const y1 = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))
                const y2 = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7))
                return Math.max(1, y2 - y1 + 1)
            })()
            const cot: CotBang[] = [
                { khoa: 'ma', nhan: 'Mã TS' },
                { khoa: 'ten', nhan: 'Tên tài sản' },
                { khoa: 'ngayMua', nhan: 'Ngày đưa vào SD', kieu: 'ngay' },
                { khoa: 'nguyenGia', nhan: 'Nguyên giá', kieu: 'tien' },
                { khoa: 'soThangKh', nhan: 'Số tháng KH', kieu: 'so' },
                { khoa: 'khThang', nhan: 'KH 1 tháng', kieu: 'tien' },
                { khoa: 'khKy', nhan: `KH trong kỳ (${soThang} tháng)`, kieu: 'tien' },
                { khoa: 'luyKe', nhan: 'KH lũy kế', kieu: 'tien' },
                { khoa: 'conLai', nhan: 'Giá trị còn lại', kieu: 'tien' },
                { khoa: 'tkChiPhi', nhan: 'TK chi phí' },
            ]
            return dungTaiLieu({
                ma: '11-khau-hao-tscd',
                ten: 'Bảng tính và phân bổ khấu hao tài sản cố định',
                mau: 'Mẫu S10-DNN',
                canCu: 'Thông tư 45/2013/TT-BTC; Điều 4 Thông tư 96/2015/TT-BTC',
                vaiTro: 'Khấu hao vượt khung thời gian tại TT 45/2013 sẽ bị loại khỏi chi phí được trừ.',
                cot,
                dong: ts.map((a: any) => ({
                    ma: a.code, ten: a.name,
                    ngayMua: String(a.acquisitionDate || '').slice(0, 10),
                    nguyenGia: r0(a.originalCost),
                    soThangKh: a.usefulLifeMonths || 0,
                    khThang: r0(a.monthlyDepreciation),
                    khKy: r0((a.monthlyDepreciation || 0) * soThang),
                    luyKe: r0(a.accumulatedDepreciation),
                    conLai: r0(a.netBookValue),
                    tkChiPhi: a.expenseAccountCode || '',
                })),
                ghiChu: 'Khấu hao trong kỳ tính theo mức tháng × số tháng, không đọc lại từng bút toán khấu hao.',
            })
        })

    // ── 12. Tờ khai đã lập ───────────────────────────────────────────────────
    await them('12-to-khai', 'Danh mục tờ khai thuế đã lập trong kỳ',
        'Thông báo tiếp nhận trên thuedientu.gdt.gov.vn', async () => {
            const tk = await prisma.taxDeclaration.findMany({
                select: {
                    formType: true, period: true, periodType: true, status: true,
                    ct29: true, ct30: true, ct33: true, ct38: true, ct40a: true, filedAt: true,
                },
            })
            const trongKy = (tk || []).filter((d: any) => {
                const p = String(d.period || '')
                const y = p.slice(0, 4)
                return y >= from.slice(0, 4) && y <= to.slice(0, 4)
            })
            if (!trongKy.length) return null
            const cot: CotBang[] = [
                { khoa: 'mau', nhan: 'Mẫu tờ khai' },
                { khoa: 'ky', nhan: 'Kỳ' },
                { khoa: 'loaiKy', nhan: 'Loại kỳ' },
                { khoa: 'trangThai', nhan: 'Trạng thái' },
                { khoa: 'dtChiuThue', nhan: 'DT chịu thuế [29]', kieu: 'tien' },
                { khoa: 'vatRa', nhan: 'Thuế đầu ra [30]', kieu: 'tien' },
                { khoa: 'vatVao', nhan: 'Thuế đầu vào [33]', kieu: 'tien' },
                { khoa: 'phaiNop', nhan: 'Phải nộp [40a]', kieu: 'tien' },
                { khoa: 'ngayNop', nhan: 'Ngày nộp', kieu: 'ngay' },
            ]
            return dungTaiLieu({
                ma: '12-to-khai',
                ten: 'Danh mục tờ khai thuế đã lập trong kỳ',
                mau: 'Mẫu 01/GTGT, 03/TNDN',
                canCu: 'Luật Quản lý thuế 38/2019/QH14',
                vaiTro: 'Đối chiếu số đã kê khai với sổ sách; chênh lệch chính là số bị truy thu.',
                cot,
                dong: trongKy
                    .sort((a: any, b: any) => String(a.period).localeCompare(String(b.period)))
                    .map((d: any) => ({
                        mau: d.formType, ky: d.period, loaiKy: d.periodType,
                        trangThai: d.status || '',
                        dtChiuThue: r0(d.ct29), vatRa: r0(d.ct30),
                        vatVao: r0(d.ct33), phaiNop: r0(d.ct38) || r0(d.ct40a),
                        ngayNop: ngayCua(d, 'filedAt'),
                    })),
            })
        })

    /* Những thứ pháp luật bắt phải có nhưng KHÔNG nằm trong phần mềm. Liệt kê ra
     * để kế toán chuẩn bị bản giấy, vì thiếu chúng thì mọi con số ở trên đều vô
     * nghĩa trước đoàn thanh tra. */
    const ngoaiHeThong: TaiLieuThieu[] = [
        {
            ma: 'x-dkkd', ten: 'Giấy chứng nhận đăng ký kinh doanh (bản sao)',
            lyDo: 'Giấy tờ pháp lý, không lưu trong phần mềm',
            layTuDau: 'Bản gốc lưu tại cửa hàng / tra cứu dangkykinhdoanh.gov.vn',
        },
        {
            ma: 'x-hdld', ten: 'Hợp đồng lao động + bảng chấm công có chữ ký',
            lyDo: 'Bản ký tay, phần mềm chỉ có số liệu lương',
            layTuDau: 'Hồ sơ nhân sự',
        },
        {
            ma: 'x-hd-thue-nha', ten: 'Hợp đồng thuê mặt bằng + chứng từ nộp thuế thay chủ nhà',
            lyDo: 'Hợp đồng bản giấy',
            layTuDau: 'Hồ sơ hợp đồng; chứng từ nộp thuế TNCN/GTGT thay chủ nhà nếu thuê của cá nhân',
        },
        {
            ma: 'x-kiem-ke', ten: 'Biên bản kiểm kê quỹ và kiểm kê kho cuối kỳ',
            lyDo: 'Phải có chữ ký của người kiểm kê, phần mềm chỉ có số liệu',
            layTuDau: 'In từ phiếu kiểm kê rồi ký, hoặc lập bổ sung',
        },
        {
            ma: 'x-sao-ke', ten: 'Sao kê tài khoản ngân hàng cả kỳ',
            lyDo: 'Do ngân hàng phát hành, phần mềm không thay thế được',
            layTuDau: 'Internet banking / quầy giao dịch, xin bản có dấu',
        },
    ]
    thieu.push(...ngoaiHeThong)

    return {
        ky: { from, to, nhan: ky.nhan || `${from} → ${to}` },
        taiLieu,
        thieu,
        tongQuan: {
            soTaiLieu: taiLieu.length,
            soDong: taiLieu.reduce((s, t) => s + t.dong.length, 0),
            soTaiLieuTrong: thieu.filter(t => !t.ma.startsWith('x-')).length,
        },
    }
}

/** Xuất một tài liệu ra CSV mở được bằng Excel (có BOM cho tiếng Việt) */
export function sangCsv(t: TaiLieuThanhTra): string {
    const esc = (v: any) => {
        const s = v === null || v === undefined ? '' : String(v)
        return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const dong: string[] = []
    dong.push(esc(t.ten))
    dong.push(esc(`${t.mau} — ${t.canCu}`))
    dong.push('')
    dong.push(t.cot.map(c => esc(c.nhan)).join(','))
    for (const d of t.dong) dong.push(t.cot.map(c => esc(d[c.khoa])).join(','))
    const coTong = t.cot.some(c => c.kieu === 'tien' || c.kieu === 'so')
    if (coTong) {
        dong.push(t.cot.map((c, i) =>
            i === 0 ? esc('TỔNG CỘNG') : esc(t.tong[c.khoa] ?? '')).join(','))
    }
    if (t.ghiChu) { dong.push(''); dong.push(esc('Ghi chú: ' + t.ghiChu)) }
    return '﻿' + dong.join('\r\n')
}

/* ────────────────────────────────────────────────────────────────────────────
 * TRUY VẾT CHỨNG TỪ
 * ──────────────────────────────────────────────────────────────────────────── */

export type TrangThaiMoc = 'co' | 'thieu' | 'khong-can' | 'khong-kiem-duoc'

export interface MocTruyVet {
    buoc: number
    ten: string
    trangThai: TrangThaiMoc
    chiTiet: string
    /** Câu đoàn thanh tra hay hỏi ở đúng mắt xích này */
    cauHoi?: string
    dulieu?: any
}

export interface KetQuaTruyVet {
    timThay: boolean
    loai: 'ban-hang' | 'nhap-hang' | 'khong-ro'
    ma: string
    tieuDe: string
    moc: MocTruyVet[]
    canhBao: string[]
    /** Mắt xích đứt = số mốc trạng thái "thiếu" */
    soMocDut: number
}

export async function truyVetChungTu(prisma: any, maTim: string): Promise<KetQuaTruyVet> {
    const ma = String(maTim || '').trim()
    const moc: MocTruyVet[] = []
    const canhBao: string[] = []
    const ket = (loai: KetQuaTruyVet['loai'], tieuDe: string): KetQuaTruyVet => ({
        timThay: moc.length > 0, loai, ma, tieuDe, moc, canhBao,
        soMocDut: moc.filter(m => m.trangThai === 'thieu').length,
    })

    if (!ma) return ket('khong-ro', 'Chưa nhập mã chứng từ cần truy vết')

    // Nhận diện: số phiếu bán → phiếu nhập → số hóa đơn điện tử
    let gd: any = await prisma.transaction.findFirst({
        where: { receiptNumber: ma },
        select: {
            id: true, receiptNumber: true, customerName: true, customerId: true,
            subtotal: true, discount: true, tax: true, total: true, amountReceived: true,
            status: true, createdByName: true, transactionDate: true, createdAt: true,
            vatStatus: true, vatInvoiceNumber: true,
            items: { select: { productName: true, sku: true, quantity: true, unitPrice: true, lineTotal: true } },
        },
    }).catch(() => null)

    if (!gd) {
        // Thử theo số hóa đơn điện tử → nhảy về giao dịch gốc
        const hd = await prisma.eInvoice.findFirst({
            where: { invoiceNumber: ma },
            select: { transactionId: true },
        }).catch(() => null)
        if (hd?.transactionId) {
            gd = await prisma.transaction.findFirst({
                where: { id: hd.transactionId },
                select: {
                    id: true, receiptNumber: true, customerName: true, customerId: true,
                    subtotal: true, discount: true, tax: true, total: true, amountReceived: true,
                    status: true, createdByName: true, transactionDate: true, createdAt: true,
                    vatStatus: true, vatInvoiceNumber: true,
                    items: { select: { productName: true, sku: true, quantity: true, unitPrice: true, lineTotal: true } },
                },
            }).catch(() => null)
        }
    }

    if (gd) return truyVetBanHang(prisma, gd, moc, canhBao, ma)

    const nhap = await prisma.importReceipt.findFirst({
        where: { code: ma },
        select: {
            id: true, code: true, supplierName: true, totalCost: true, vatAmount: true,
            paidAmount: true, paymentStatus: true, hasVatInvoice: true, vatInvoiceNo: true,
            status: true, userName: true, transactionDate: true, createdAt: true,
            items: { select: { productName: true, productSku: true, quantity: true, costPrice: true, total: true } },
        },
    }).catch(() => null)

    if (nhap) return truyVetNhapHang(prisma, nhap, moc, canhBao, ma)

    return ket('khong-ro',
        `Không tìm thấy chứng từ "${ma}". Nhập số phiếu bán (vd HD000123), mã phiếu nhập, hoặc số hóa đơn điện tử.`)
}

async function truyVetBanHang(
    prisma: any, gd: any, moc: MocTruyVet[], canhBao: string[], ma: string,
): Promise<KetQuaTruyVet> {
    const ngayBan = ngayCua(gd, 'transactionDate', 'createdAt')

    moc.push({
        buoc: 1,
        ten: 'Chứng từ gốc — phiếu bán hàng',
        trangThai: 'co',
        chiTiet: `${gd.receiptNumber} ngày ${ngayBan}, khách "${gd.customerName || 'khách lẻ'}", tổng ${r0(gd.total).toLocaleString('vi-VN')}đ, người lập ${gd.createdByName || 'không ghi'}.`,
        cauHoi: 'Ai lập phiếu này, bán cho ai?',
        dulieu: { id: gd.id, ngay: ngayBan, tong: r0(gd.total), trangThai: gd.status },
    })

    const soDong = gd.items?.length || 0
    moc.push({
        buoc: 2,
        ten: 'Hàng hóa xuất kho',
        trangThai: soDong ? 'co' : 'thieu',
        chiTiet: soDong
            ? `${soDong} mặt hàng, tổng số lượng ${gd.items.reduce((s: number, i: any) => s + (i.quantity || 0), 0)}.`
            : 'Phiếu bán KHÔNG có dòng hàng — không chứng minh được đã giao hàng gì.',
        cauHoi: 'Hàng xuất kho theo phiếu nào, tồn kho có giảm tương ứng không?',
        dulieu: gd.items?.slice(0, 20),
    })
    if (!soDong) canhBao.push('Phiếu bán không có dòng hàng: doanh thu không gắn với hàng hóa cụ thể.')

    const hd = await prisma.eInvoice.findFirst({
        where: { transactionId: gd.id },
        select: {
            invoiceNumber: true, invoiceSymbol: true, invoiceDate: true, status: true,
            totalBeforeVat: true, vatAmount: true, totalAmount: true, lookupCode: true,
            buyerName: true, buyerTaxCode: true,
        },
    }).catch(() => null)

    if (hd) {
        const daKy = ['SIGNED', 'SENT'].includes(String(hd.status))
        moc.push({
            buoc: 3,
            ten: 'Hóa đơn điện tử',
            trangThai: daKy ? 'co' : 'thieu',
            chiTiet: `Số ${hd.invoiceNumber || '(chưa cấp)'} ký hiệu ${hd.invoiceSymbol || ''} ngày ${hd.invoiceDate || ''}, trạng thái ${hd.status}. Tổng thanh toán ${r0(hd.totalAmount).toLocaleString('vi-VN')}đ.`,
            cauHoi: 'Hóa đơn lập ngày nào so với ngày giao hàng?',
            dulieu: hd,
        })
        if (!daKy) canhBao.push(`Hóa đơn ở trạng thái ${hd.status} — chưa phát hành hợp lệ.`)
        if (hd.invoiceDate && ngayBan && hd.invoiceDate !== ngayBan) {
            canhBao.push(`Ngày hóa đơn (${hd.invoiceDate}) khác ngày bán (${ngayBan}) — Điều 9 NĐ 123/2020 buộc lập tại thời điểm chuyển giao hàng.`)
        }
        const lechTien = Math.abs(r0(hd.totalAmount) - r0(gd.total))
        if (lechTien > 1000) {
            canhBao.push(`Tổng hóa đơn lệch phiếu bán ${lechTien.toLocaleString('vi-VN')}đ.`)
        }
    } else {
        moc.push({
            buoc: 3,
            ten: 'Hóa đơn điện tử',
            trangThai: 'thieu',
            chiTiet: 'Chưa lập hóa đơn điện tử cho phiếu bán này.',
            cauHoi: 'Vì sao bán hàng mà không xuất hóa đơn?',
        })
        canhBao.push('Chưa có hóa đơn điện tử: Điều 90 Luật Quản lý thuế buộc lập hóa đơn khi bán hàng, kể cả khách không lấy.')
    }

    const bt = await prisma.journalEntry.findMany({
        where: { reference: { in: [`SALE-${gd.receiptNumber}`, `VAT-${gd.receiptNumber}`, `COGS-${gd.receiptNumber}`, `DISC-${gd.receiptNumber}`, `COLLECT-${gd.receiptNumber}`] } },
        select: { reference: true, debitAccount: true, creditAccount: true, amount: true, date: true, description: true },
    }).catch(() => [])
    const co = (tienTo: string) => (bt || []).find((b: any) => String(b.reference).startsWith(tienTo))
    const btDt = co('SALE-'), btVat = co('VAT-'), btGv = co('COGS-')

    moc.push({
        buoc: 4,
        ten: 'Bút toán ghi sổ',
        trangThai: btDt ? 'co' : 'thieu',
        chiTiet: btDt
            ? `Doanh thu ${r0(btDt.amount).toLocaleString('vi-VN')}đ (${btDt.debitAccount}/${btDt.creditAccount})` +
            (btVat ? `; thuế GTGT ${r0(btVat.amount).toLocaleString('vi-VN')}đ` : '; CHƯA có bút toán thuế') +
            (btGv ? `; giá vốn ${r0(btGv.amount).toLocaleString('vi-VN')}đ` : '; CHƯA có bút toán giá vốn')
            : 'Chưa ghi sổ doanh thu cho phiếu bán này.',
        cauHoi: 'Doanh thu này vào sổ ngày nào, định khoản ra sao?',
        dulieu: bt,
    })
    if (!btDt) canhBao.push('Chưa ghi sổ: doanh thu có trên phần mềm bán hàng nhưng không có trên sổ kế toán.')
    if (btDt && !btGv) canhBao.push('Có doanh thu nhưng chưa kết chuyển giá vốn — lãi trên sổ bị thổi phồng.')

    const conNo = r0(gd.total) - r0(gd.amountReceived)
    moc.push({
        buoc: 5,
        ten: 'Thu tiền / công nợ',
        trangThai: 'co',
        chiTiet: conNo > 0
            ? `Đã thu ${r0(gd.amountReceived).toLocaleString('vi-VN')}đ, còn nợ ${conNo.toLocaleString('vi-VN')}đ — phải có trên sổ chi tiết 131.`
            : `Đã thu đủ ${r0(gd.amountReceived).toLocaleString('vi-VN')}đ.`,
        cauHoi: conNo > 0 ? 'Khoản nợ này đã đối chiếu với khách chưa?' : 'Tiền thu về bằng gì, có vào quỹ/ngân hàng không?',
    })
    if (conNo > 0 && !gd.customerId) {
        canhBao.push('Bán nợ nhưng không gắn khách hàng — không theo dõi được công nợ, đoàn coi là doanh thu không có người mua.')
    }

    const ngayKk = hd?.invoiceDate || ngayBan
    if (ngayKk) {
        const maKy = ngayKk.slice(0, 7)
        const tk = await prisma.taxDeclaration.findFirst({
            where: { period: maKy },
            select: { period: true, status: true, ct29: true, filedAt: true },
        }).catch(() => null)
        moc.push({
            buoc: 6,
            ten: 'Kỳ kê khai thuế',
            trangThai: tk ? 'co' : 'thieu',
            chiTiet: tk
                ? `Thuộc kỳ ${maKy}, tờ khai trạng thái "${tk.status}", doanh thu chịu thuế kê khai ${r0(tk.ct29).toLocaleString('vi-VN')}đ.`
                : `Thuộc kỳ ${maKy} nhưng CHƯA có tờ khai kỳ này trong hệ thống.`,
            cauHoi: 'Doanh thu này nằm ở chỉ tiêu nào trên tờ khai kỳ nào?',
            dulieu: tk,
        })
        if (!tk) canhBao.push(`Chưa lập tờ khai kỳ ${maKy} chứa chứng từ này.`)
    }

    return {
        timThay: true, loai: 'ban-hang', ma,
        tieuDe: `Phiếu bán ${gd.receiptNumber} — ${ngayBan}`,
        moc, canhBao,
        soMocDut: moc.filter(m => m.trangThai === 'thieu').length,
    }
}

async function truyVetNhapHang(
    prisma: any, n: any, moc: MocTruyVet[], canhBao: string[], ma: string,
): Promise<KetQuaTruyVet> {
    const ngayNhap = ngayCua(n, 'transactionDate', 'createdAt')

    moc.push({
        buoc: 1,
        ten: 'Chứng từ gốc — phiếu nhập kho',
        trangThai: 'co',
        chiTiet: `${n.code} ngày ${ngayNhap}, NCC "${n.supplierName || 'không ghi'}", giá trị ${r0(n.totalCost).toLocaleString('vi-VN')}đ, người nhập ${n.userName || ''}.`,
        cauHoi: 'Mua của ai, ai nhận hàng?',
        dulieu: { ngay: ngayNhap, tong: r0(n.totalCost), trangThai: n.status },
    })

    const soDong = n.items?.length || 0
    moc.push({
        buoc: 2,
        ten: 'Hàng nhập kho',
        trangThai: soDong ? 'co' : 'thieu',
        chiTiet: soDong ? `${soDong} mặt hàng.` : 'Phiếu nhập không có dòng hàng.',
        cauHoi: 'Hàng nhập kho nào, ai ký nhận?',
        dulieu: n.items?.slice(0, 20),
    })

    moc.push({
        buoc: 3,
        ten: 'Hóa đơn đầu vào',
        trangThai: n.hasVatInvoice ? 'co' : 'thieu',
        chiTiet: n.hasVatInvoice
            ? `Số hóa đơn ${n.vatInvoiceNo || '(chưa nhập số)'}, thuế GTGT ${r0(n.vatAmount).toLocaleString('vi-VN')}đ.`
            : 'KHÔNG có hóa đơn đầu vào — toàn bộ giá trị lô hàng này không đủ điều kiện tính vào chi phí được trừ.',
        cauHoi: 'Hóa đơn mua hàng đâu, MST người bán là gì?',
    })
    if (!n.hasVatInvoice) {
        canhBao.push(`Nhập ${r0(n.totalCost).toLocaleString('vi-VN')}đ không hóa đơn — Điều 4 TT 96/2015 loại khỏi chi phí được trừ khi tính thuế TNDN.`)
    } else if (!n.vatInvoiceNo) {
        canhBao.push('Đánh dấu có hóa đơn nhưng chưa nhập số hóa đơn — không tra cứu đối chiếu được.')
    }

    const bt = await prisma.journalEntry.findMany({
        where: { reference: { in: [`IMP-${n.code}`, `IMPVAT-${n.code}`, `IMPPAY-${n.code}`] } },
        select: { reference: true, debitAccount: true, creditAccount: true, amount: true, date: true },
    }).catch(() => [])
    const btNhap = (bt || []).find((b: any) => String(b.reference).startsWith('IMP-'))
    moc.push({
        buoc: 4,
        ten: 'Bút toán ghi sổ',
        trangThai: btNhap ? 'co' : 'thieu',
        chiTiet: btNhap
            ? `Nợ ${btNhap.debitAccount}/Có ${btNhap.creditAccount} ${r0(btNhap.amount).toLocaleString('vi-VN')}đ` +
            (bt.length > 1 ? ` (+${bt.length - 1} bút toán liên quan)` : '')
            : 'Chưa ghi sổ phiếu nhập này — hàng đã vào kho nhưng sổ kế toán không có.',
        cauHoi: 'Giá trị hàng nhập vào TK 156 ngày nào?',
        dulieu: bt,
    })
    if (!btNhap) canhBao.push('Chưa ghi sổ phiếu nhập: tồn kho thực tế và sổ sách sẽ lệch.')

    const conNo = r0(n.totalCost) - r0(n.paidAmount)
    const traNgay = conNo <= 0
    const NGUONG_TIEN_MAT = 5_000_000
    moc.push({
        buoc: 5,
        ten: 'Thanh toán cho nhà cung cấp',
        trangThai: 'co',
        chiTiet: traNgay
            ? `Đã trả đủ ${r0(n.paidAmount).toLocaleString('vi-VN')}đ.`
            : `Đã trả ${r0(n.paidAmount).toLocaleString('vi-VN')}đ, còn nợ ${conNo.toLocaleString('vi-VN')}đ (theo dõi trên TK 331).`,
        cauHoi: 'Trả bằng tiền mặt hay chuyển khoản, chứng từ thanh toán đâu?',
    })
    if (r0(n.totalCost) >= NGUONG_TIEN_MAT && n.hasVatInvoice) {
        canhBao.push(`Lô hàng ${r0(n.totalCost).toLocaleString('vi-VN')}đ ≥ 5 triệu: phải có chứng từ thanh toán KHÔNG DÙNG TIỀN MẶT mới được khấu trừ GTGT và tính chi phí (Luật Thuế GTGT 48/2024, NĐ 181/2025 áp dụng từ 01/7/2025).`)
    }

    return {
        timThay: true, loai: 'nhap-hang', ma,
        tieuDe: `Phiếu nhập ${n.code} — ${ngayNhap}`,
        moc, canhBao,
        soMocDut: moc.filter(m => m.trangThai === 'thieu').length,
    }
}
