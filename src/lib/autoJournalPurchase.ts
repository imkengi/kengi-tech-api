/**
 * Bút toán tự động cho PHÍA MUA / CHI PHÍ / TRẢ HÀNG.
 *
 * Trước 08/2026 chỉ phía BÁN được ghi sổ tự động (autoJournal.ts); nhập hàng,
 * chi phí và trả hàng chỉ sinh bút toán khi kế toán bấm chạy backfill
 * (POST /api/tax/auto-journal). Quên chạy là sổ 156/331/641/642 trống rỗng →
 * Bảng cân đối kế toán và Kết quả kinh doanh đều sai. Các hàm ở đây cho phép
 * ghi NGAY lúc nghiệp vụ phát sinh; backfill dùng lại đúng các hàm này nên hai
 * đường luôn cho ra cùng một bộ sổ.
 *
 * Khóa chống trùng (reference) — ĐỪNG đổi tiền tố, hàm đảo bút toán và báo cáo
 * dò theo chúng:
 *   IMP-<mã phiếu>        hàng nhập kho          Nợ 156  / Có 331
 *   IMPVAT-<mã phiếu>     VAT đầu vào            Nợ 1331 / Có 331
 *   IMPPAY-<mã phiếu>     trả tiền ngay khi nhập Nợ 331  / Có 111|112
 *   PAYSUP-<mã phiếu>-<n> trả nợ NCC lần sau     Nợ 331  / Có 111|112
 *   EXP-<id>              chi phí                Nợ 641|642 / Có 111|112
 *   EXPVAT-<id>           VAT của chi phí        Nợ 1331 / Có 111|112
 *   RET-<mã phiếu trả>    hàng bán bị trả lại    Nợ 5212 / Có 111|131
 *   RETVAT-<mã>           giảm VAT đầu ra        Nợ 3331 / Có 111|131
 *   RETCOGS-<mã>          nhập lại kho           Nợ 156  / Có 632
 *
 * Ghi hỏng thì KHÔNG chặn nghiệp vụ gốc (phiếu nhập, phiếu chi vẫn lưu), nhưng
 * từ 03/09/2026 KHÔNG còn nuốt im lặng: trùng khóa là chuyện bình thường của cơ
 * chế chống ghi hai lần nên bỏ qua, còn mọi lỗi khác đều ghi log kèm số phiếu và
 * cặp tài khoản — trước đây `catch (_) { return false }` che sạch, nên một phiếu
 * nhập không vào được sổ vẫn báo thành công.
 *
 * KHOÁ SỔ: mỗi nghiệp vụ kiểm một lần trước khi ghi (chanKhoaSo). Chứng từ lùi
 * ngày vào kỳ đã khoá bị NÉM LỖI chứ không ghi nửa vời.
 */
import { khoaSoChan, loiKhoaSo } from './periodLock'

const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

export interface JournalOpts {
    branchId?: string | null
    userId?: string | null
    /**
     * Cho phép ghi vào kỳ ĐÃ KHOÁ SỔ. Chỉ đường SỬA CHỮA do người dùng chủ động
     * bấm mới được bật (ghi bù bút toán thiếu / đối chiếu sổ sách).
     */
    boQuaKhoaSo?: boolean
}

/** Chặn ghi vào kỳ đã khoá. Gọi MỘT lần cho mỗi chứng từ, trước khi ghi. */
async function chanKhoaSo(
    client: any, opts: JournalOpts, branchId: string | null, date: string, chungTu: string,
): Promise<void> {
    if (opts.boQuaKhoaSo) return
    const khoa = await khoaSoChan(client, branchId, date)
    if (khoa) throw loiKhoaSo(khoa, chungTu)
}

export interface JournalResult {
    created: Array<{ type: string; ref: string; amount: number }>
}

/** Tài khoản tiền theo phương thức thanh toán */
function tkTien(method?: string | null): { code: string; name: string } {
    const m = String(method || '').toLowerCase()
    const laNganHang = m === 'bank' || m === 'transfer' || m === 'bank_transfer' || m === 'card' || m === 'ewallet'
    return laNganHang
        ? { code: '112', name: 'Tiền gửi ngân hàng' }
        : { code: '111', name: 'Tiền mặt' }
}

/** Ghi một bút toán; trả về true nếu thực sự tạo mới */
async function ghi(client: any, d: {
    date: string; description: string
    debitAccount: string; debitAccountName: string
    creditAccount: string; creditAccountName: string
    amount: number; reference: string; referenceType: string
    branchId?: string | null; userId?: string | null
}): Promise<boolean> {
    const amount = Math.round(d.amount || 0)
    if (amount <= 0) return false
    try {
        await client.journalEntry.create({
            data: {
                date: d.date, description: d.description,
                debitAccount: d.debitAccount, debitAccountName: d.debitAccountName,
                creditAccount: d.creditAccount, creditAccountName: d.creditAccountName,
                amount, reference: d.reference, referenceType: d.referenceType,
                branchId: d.branchId ?? null, createdBy: d.userId ?? null,
            },
        })
        return true
    } catch (e: any) {
        /* Trùng `reference` = đã ghi rồi, đúng thiết kế chống ghi hai lần → im lặng.
         * Lỗi KHÁC thì phải nói: bản cũ nuốt sạch nên một phiếu nhập không vào được
         * sổ vẫn báo thành công, tồn kho tăng mà giá vốn/công nợ NCC không ghi. */
        if (!(e?.code === 'P2002' || /unique|duplicate/i.test(String(e?.message || '')))) {
            console.error(
                `[autoJournalPurchase] KHÔNG ghi được bút toán ref=${d.reference} ` +
                `(Nợ ${d.debitAccount} / Có ${d.creditAccount} ${amount}): ${e?.message || e}`,
            )
        }
        return false
    }
}

/* ─── NHẬP HÀNG ──────────────────────────────────────────────────────────── */

export interface ImportReceiptForJournal {
    code: string
    supplierName?: string | null
    /** Tổng thành tiền các dòng, CHƯA gồm VAT và chi phí cấp phiếu */
    totalCost: number
    vatAmount?: number | null
    shippingFee?: number | null
    importTax?: number | null
    otherFees?: number | null
    totalDiscount?: number | null
    paidAmount?: number | null
    branchId?: string | null
    transactionDate?: Date | null
    createdAt?: Date | null
}

/**
 * Giá trị vào kho khớp đúng cách route tính giá vốn (landed cost): giá mua +
 * vận chuyển + thuế nhập khẩu + phí khác − chiết khấu; cộng cả VAT nếu là hộ
 * kinh doanh (VAT không được khấu trừ nên nằm luôn trong giá vốn).
 *
 * `vatKhauTru = false` (HKD/cá nhân) thì KHÔNG ghi 1331 nữa — ghi cả vào giá
 * vốn lẫn 1331 là ghi trùng, làm phồng tài sản.
 */
export async function postImportReceiptJournal(
    client: any,
    r: ImportReceiptForJournal,
    opts: JournalOpts & { vatKhauTru?: boolean } = {},
): Promise<JournalResult> {
    const result: JournalResult = { created: [] }
    if (!r?.code) return result

    const date = fmtDate(r.transactionDate || r.createdAt || new Date())
    const branchId = opts.branchId ?? r.branchId ?? null
    const userId = opts.userId ?? null
    await chanKhoaSo(client, opts, branchId, date, `phiếu nhập ${r.code}`)
    const vat = Math.round(Number(r.vatAmount) || 0)
    const vatKhauTru = opts.vatKhauTru !== false
    const phiKhac = (Number(r.shippingFee) || 0) + (Number(r.importTax) || 0)
        + (Number(r.otherFees) || 0) - (Number(r.totalDiscount) || 0)
    const giaTriKho = Math.round((Number(r.totalCost) || 0) + phiKhac + (vatKhauTru ? 0 : vat))
    const ncc = r.supplierName ? ` - NCC: ${r.supplierName}` : ''

    if (await ghi(client, {
        date, description: `Nhập hàng ${r.code}${ncc}`,
        debitAccount: '156', debitAccountName: 'Hàng hóa',
        creditAccount: '331', creditAccountName: 'Phải trả người bán',
        amount: giaTriKho, reference: `IMP-${r.code}`, referenceType: 'import', branchId, userId,
    })) result.created.push({ type: 'import', ref: `IMP-${r.code}`, amount: giaTriKho })

    if (vatKhauTru && vat > 0 && await ghi(client, {
        date, description: `Thuế GTGT đầu vào ${r.code}${ncc}`,
        debitAccount: '1331', debitAccountName: 'Thuế GTGT được khấu trừ của hàng hóa, dịch vụ',
        creditAccount: '331', creditAccountName: 'Phải trả người bán',
        amount: vat, reference: `IMPVAT-${r.code}`, referenceType: 'import', branchId, userId,
    })) result.created.push({ type: 'import-vat', ref: `IMPVAT-${r.code}`, amount: vat })

    const daTra = Math.round(Number(r.paidAmount) || 0)
    if (daTra > 0) {
        const tien = tkTien(null)
        if (await ghi(client, {
            date, description: `Trả tiền NCC phiếu ${r.code}${ncc}`,
            debitAccount: '331', debitAccountName: 'Phải trả người bán',
            creditAccount: tien.code, creditAccountName: tien.name,
            amount: daTra, reference: `IMPPAY-${r.code}`, referenceType: 'import', branchId, userId,
        })) result.created.push({ type: 'import-pay', ref: `IMPPAY-${r.code}`, amount: daTra })
    }
    return result
}

/** Trả nợ NCC sau khi nhập: Nợ 331 / Có 111|112. `seq` để mỗi lần trả có khóa riêng. */
export async function postSupplierPaymentJournal(client: any, o: {
    receiptCode: string
    amount: number
    seq: string | number
    method?: string | null
    supplierName?: string | null
    date?: string
    branchId?: string | null
    userId?: string | null
}): Promise<void> {
    const tien = tkTien(o.method)
    const ngayTra = o.date || fmtDate(new Date())
    await chanKhoaSo(client, o as JournalOpts, o.branchId ?? null, ngayTra, `phiếu trả nợ NCC ${o.receiptCode}`)
    await ghi(client, {
        date: ngayTra,
        description: `Trả nợ NCC phiếu ${o.receiptCode}${o.supplierName ? ' - ' + o.supplierName : ''}`,
        debitAccount: '331', debitAccountName: 'Phải trả người bán',
        creditAccount: tien.code, creditAccountName: tien.name,
        amount: o.amount, reference: `PAYSUP-${o.receiptCode}-${o.seq}`, referenceType: 'import',
        branchId: o.branchId ?? null, userId: o.userId ?? null,
    })
}

/* ─── CHI PHÍ ────────────────────────────────────────────────────────────── */

/**
 * Loại chi phí → tài khoản. GIỮ NGUYÊN bộ mã mà backfill trong tax.ts đã dùng
 * từ trước (6421/6422/6411/6415/6418/6423/6424/6425/6428) — đổi mã ở đây sẽ
 * khiến cùng một loại chi phí nằm ở hai tài khoản khác nhau tùy theo nó được
 * ghi lúc phát sinh hay lúc chạy backfill, và mọi báo cáo so kỳ sẽ gãy.
 * Bốn loại của giao diện chi phí (điện/nước/internet/ăn uống) trước đây rơi hết
 * vào 6428 "CP khác" — nay tách điện/nước/internet về 6422 cho đúng bản chất.
 */
export const TK_CHI_PHI: Record<string, { code: string; name: string }> = {
    rent: { code: '6421', name: 'CP thuê mặt bằng' },
    utilities: { code: '6422', name: 'CP điện nước' },
    electricity: { code: '6422', name: 'CP điện nước' },
    water: { code: '6422', name: 'CP điện nước' },
    internet: { code: '6422', name: 'CP điện nước' },
    salary: { code: '6411', name: 'CP lương nhân viên' },
    transport: { code: '6415', name: 'CP vận chuyển' },
    marketing: { code: '6418', name: 'CP marketing' },
    maintenance: { code: '6423', name: 'CP sửa chữa' },
    supplies: { code: '6424', name: 'CP vật tư' },
    insurance: { code: '6425', name: 'CP bảo hiểm' },
    // Trả tiền NCC KHÔNG phải chi phí — là giảm khoản phải trả. Ghi Nợ 331 / Có 11x.
    // Xếp vào 6428 là tính trùng: giá vốn đã vào 632 khi bán rồi.
    supplier_payment: { code: '331', name: 'Phải trả người bán' },
    other: { code: '6428', name: 'CP khác' },
}

export interface ExpenseForJournal {
    id: string
    description: string
    amount: number
    category?: string | null
    date: Date
    vatAmount?: number | null
    /** 'bank' | 'transfer' → Có 112; còn lại Có 111 (đúng quy ước sẵn có) */
    paidBy?: string | null
    bankAccountId?: string | null
    supplierName?: string | null
    branchId?: string | null
}

/**
 * Nợ 641|642 / Có 111|112, tách VAT đầu vào sang 1331.
 * `Expense.amount` là SỐ TIỀN ĐÃ CHI (gồm VAT nếu có) nên phần chi phí thuần =
 * amount − vatAmount; ghi nguyên amount vào 642 rồi ghi thêm 1331 là tính trùng
 * thuế vào chi phí, làm lãi thấp giả.
 */
export async function postExpenseJournal(
    client: any, e: ExpenseForJournal, opts: JournalOpts & { vatKhauTru?: boolean } = {},
): Promise<JournalResult> {
    const result: JournalResult = { created: [] }
    if (!e?.id) return result

    const date = fmtDate(e.date || new Date())
    const branchId = opts.branchId ?? e.branchId ?? null
    const userId = opts.userId ?? null
    await chanKhoaSo(client, opts, branchId, date, `phiếu chi ${e.id}`)
    const tien = tkTien(e.paidBy || (e.bankAccountId ? 'bank' : 'cash'))
    const loai = String(e.category || 'other').toLowerCase()
    const tk = TK_CHI_PHI[loai] ?? TK_CHI_PHI.other!
    /* Trả tiền NCC không có thuế đầu vào để khấu trừ (thuế đã ghi lúc nhập hàng),
     * nên bỏ qua phần VAT cho loại này — nếu không sẽ khấu trừ hai lần. */
    const laTraNcc = loai === 'supplier_payment'
    const vatKhauTru = opts.vatKhauTru !== false && !laTraNcc
    const vat = vatKhauTru ? Math.round(Number(e.vatAmount) || 0) : 0
    const tienChiPhi = Math.round((Number(e.amount) || 0) - vat)
    const nguon = e.supplierName ? ` - ${e.supplierName}` : ''

    if (await ghi(client, {
        date, description: `${e.description}${nguon}`,
        debitAccount: tk.code, debitAccountName: tk.name,
        creditAccount: tien.code, creditAccountName: tien.name,
        amount: tienChiPhi, reference: `EXP-${e.id}`, referenceType: 'expense', branchId, userId,
    })) result.created.push({ type: 'expense', ref: `EXP-${e.id}`, amount: tienChiPhi })

    if (vat > 0 && await ghi(client, {
        date, description: `Thuế GTGT đầu vào - ${e.description}${nguon}`,
        debitAccount: '1331', debitAccountName: 'Thuế GTGT được khấu trừ của hàng hóa, dịch vụ',
        creditAccount: tien.code, creditAccountName: tien.name,
        amount: vat, reference: `EXPVAT-${e.id}`, referenceType: 'expense', branchId, userId,
    })) result.created.push({ type: 'expense-vat', ref: `EXPVAT-${e.id}`, amount: vat })

    return result
}

/* ─── TRẢ HÀNG ───────────────────────────────────────────────────────────── */

export interface ReturnForJournal {
    code: string
    customerName?: string | null
    originalInvoice?: string | null
    /** Số tiền trả lại khách (gồm VAT nếu hóa đơn gốc có) */
    totalRefund: number
    refundMethod?: string | null
    /** Giá vốn hàng nhập lại kho — 0 nếu hàng hỏng không nhập lại */
    costValue?: number | null
    vatAmount?: number | null
    branchId?: string | null
    createdAt?: Date | null
}

/**
 * Nợ 5212 / Có 111|131 (giảm doanh thu), Nợ 3331 / Có 111|131 (giảm VAT đầu ra),
 * Nợ 156 / Có 632 (nhập lại kho).
 * Trả bằng store_credit / đổi hàng thì không xuất quỹ: đối ứng ghi 131 — coi như
 * khoản còn nợ lại khách, đúng bản chất và không làm lệch sổ quỹ tiền mặt.
 */
export async function postReturnJournal(
    client: any, r: ReturnForJournal, opts: JournalOpts = {},
): Promise<JournalResult> {
    const result: JournalResult = { created: [] }
    if (!r?.code) return result

    const date = fmtDate(r.createdAt || new Date())
    const branchId = opts.branchId ?? r.branchId ?? null
    const userId = opts.userId ?? null
    await chanKhoaSo(client, opts, branchId, date, `phiếu trả hàng ${r.code}`)
    const method = String(r.refundMethod || 'cash')
    const traBangTien = method === 'cash' || method === 'bank_transfer' || method === 'bank' || method === 'transfer'
    const doiUng = traBangTien ? tkTien(method) : { code: '131', name: 'Phải thu khách hàng' }

    const vat = Math.round(Number(r.vatAmount) || 0)
    const tienHang = Math.round((Number(r.totalRefund) || 0) - vat)
    const khach = r.customerName ? ` - KH: ${r.customerName}` : ''
    const hdGoc = r.originalInvoice ? ` (HĐ ${r.originalInvoice})` : ''

    if (await ghi(client, {
        date, description: `Hàng bán bị trả lại ${r.code}${hdGoc}${khach}`,
        debitAccount: '5212', debitAccountName: 'Hàng bán bị trả lại',
        creditAccount: doiUng.code, creditAccountName: doiUng.name,
        amount: tienHang, reference: `RET-${r.code}`, referenceType: 'return', branchId, userId,
    })) result.created.push({ type: 'return', ref: `RET-${r.code}`, amount: tienHang })

    if (vat > 0 && await ghi(client, {
        date, description: `Giảm thuế GTGT đầu ra do trả hàng ${r.code}`,
        debitAccount: '3331', debitAccountName: 'Thuế giá trị gia tăng phải nộp',
        creditAccount: doiUng.code, creditAccountName: doiUng.name,
        amount: vat, reference: `RETVAT-${r.code}`, referenceType: 'return', branchId, userId,
    })) result.created.push({ type: 'return-vat', ref: `RETVAT-${r.code}`, amount: vat })

    const giaVon = Math.round(Number(r.costValue) || 0)
    if (giaVon > 0 && await ghi(client, {
        date, description: `Nhập lại kho hàng trả ${r.code}`,
        debitAccount: '156', debitAccountName: 'Hàng hóa',
        creditAccount: '632', creditAccountName: 'Giá vốn hàng bán',
        amount: giaVon, reference: `RETCOGS-${r.code}`, referenceType: 'return', branchId, userId,
    })) result.created.push({ type: 'return-cogs', ref: `RETCOGS-${r.code}`, amount: giaVon })

    return result
}

/* ─── ĐIỀU CHỈNH / KIỂM KÊ KHO ───────────────────────────────────────────── */

export interface StockAdjustForJournal {
    /** id của InventoryTransaction — làm khóa chống trùng */
    id: string
    productName?: string | null
    /** Dương = thừa so với sổ, âm = thiếu */
    quantity: number
    /** Giá vốn đơn vị tại thời điểm điều chỉnh */
    costPrice: number
    reason?: string | null
    branchId?: string | null
    date?: Date | null
}

/**
 * Kiểm kê phát hiện chênh lệch thì phải đưa vào sổ, nếu không hao hụt kho hoàn
 * toàn vô hình: TK 156 trên sổ cứ giữ nguyên trong khi hàng đã không còn.
 *
 *   Thiếu (quantity < 0): Nợ 1381 Tài sản thiếu chờ xử lý / Có 156
 *   Thừa  (quantity > 0): Nợ 156 / Có 3381 Tài sản thừa chờ giải quyết
 *
 * Dừng ở 1381/3381 là CỐ Ý: chưa biết nguyên nhân (mất trộm, đổ vỡ, nhập sai
 * sổ) thì chưa được đưa thẳng vào giá vốn hay chi phí. Kế toán xử lý xong mới
 * kết chuyển 1381 sang 632/811 hoặc bắt bồi thường.
 */
export async function postStockAdjustJournal(
    client: any, a: StockAdjustForJournal, opts: JournalOpts = {},
): Promise<JournalResult> {
    const result: JournalResult = { created: [] }
    if (!a?.id) return result
    const soLuong = Number(a.quantity) || 0
    const giaTri = Math.round(Math.abs(soLuong) * (Number(a.costPrice) || 0))
    if (giaTri <= 0) return result

    const date = fmtDate(a.date || new Date())
    const branchId = opts.branchId ?? a.branchId ?? null
    const userId = opts.userId ?? null
    await chanKhoaSo(client, opts, branchId, date, `phiếu điều chỉnh kho ${a.id}`)
    const ten = a.productName ? ` - ${a.productName}` : ''
    const lyDo = a.reason ? ` (${a.reason})` : ''
    const ref = `ADJ-${a.id}`

    const thieu = soLuong < 0
    if (await ghi(client, {
        date,
        description: `${thieu ? 'Kiểm kê thiếu' : 'Kiểm kê thừa'}${ten}${lyDo}`,
        debitAccount: thieu ? '1381' : '156',
        debitAccountName: thieu ? 'Tài sản thiếu chờ xử lý' : 'Hàng hóa',
        creditAccount: thieu ? '156' : '3381',
        creditAccountName: thieu ? 'Hàng hóa' : 'Tài sản thừa chờ giải quyết',
        amount: giaTri, reference: ref, referenceType: 'adjustment', branchId, userId,
    })) result.created.push({ type: thieu ? 'adjust-short' : 'adjust-over', ref, amount: giaTri })

    return result
}

/* ─── ĐẢO BÚT TOÁN KHI HỦY / XÓA ─────────────────────────────────────────── */

/** Danh sách reference của một phiếu nhập */
export const refsOfImport = (code: string) => [`IMP-${code}`, `IMPVAT-${code}`, `IMPPAY-${code}`]
/** Danh sách reference của một khoản chi phí */
export const refsOfExpense = (id: string) => [`EXP-${id}`, `EXPVAT-${id}`]
/** Danh sách reference của một phiếu trả hàng */
export const refsOfReturn = (code: string) => [`RET-${code}`, `RETVAT-${code}`, `RETCOGS-${code}`]

/**
 * Ghi bút toán ĐẢO cho các reference đã cho (không xóa bản ghi cũ — sổ kế toán
 * chỉ được sửa bằng bút toán đảo, xóa trắng là mất dấu vết kiểm toán).
 */
export async function reverseJournalRefs(
    prisma: any, refs: string[], opts: JournalOpts = {},
): Promise<number> {
    if (!refs?.length) return 0
    let dem = 0
    try {
        const entries = await prisma.journalEntry.findMany({ where: { reference: { in: refs } } })
        const date = fmtDate(new Date())
        for (const e of entries) {
            const ref = String(e.reference || '')
            if (!ref || ref.startsWith('VOID-')) continue
            if (await ghi(prisma, {
                date, description: `Đảo: ${e.description || ref}`,
                debitAccount: e.creditAccount, debitAccountName: e.creditAccountName,
                creditAccount: e.debitAccount, creditAccountName: e.debitAccountName,
                amount: e.amount, reference: `VOID-${ref}`, referenceType: 'void',
                branchId: opts.branchId ?? e.branchId ?? null, userId: opts.userId ?? null,
            })) dem++
        }
    } catch { /* ignore */ }
    return dem
}
