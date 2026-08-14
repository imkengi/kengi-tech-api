/**
 * Kiểm chứng bộ ĐỐI CHIẾU SỔ SÁCH bằng dữ liệu giả.
 *
 * Chạy:  npx tsx scripts/check-reconcile.ts
 *
 * Dựng một "cửa hàng" trong bộ nhớ với các sai lệch CỐ Ý gài sẵn, rồi kiểm tra
 * bộ soát có bắt đúng từng loại không — và quan trọng không kém: có im lặng khi
 * sổ sạch hay không (cảnh báo giả làm kế toán mất niềm tin nhanh hơn là bỏ sót).
 */

import { soatSoSach } from '../src/lib/reconcile'

const NGAY = (s: string) => new Date(`${s}T03:00:00.000Z`)

interface Kho {
    journal: any[]
    transactions: any[]
    imports: any[]
    expenses: any[]
    returns: any[]
    customers: any[]
    products: any[]
    locks: any[]
    adjustments: any[]
    chartOfAccounts: any[]
    /** 'household' = hộ kinh doanh (không bắt buộc sổ kép), mặc định doanh nghiệp. */
    loaiHinh?: string
}

/** Prisma giả — chỉ hỗ trợ đúng những phép truy vấn mà reconcile.ts dùng */
function fakePrisma(k: Kho) {
    const trongKhoang = (v: any, w: any) => {
        if (!w) return true
        const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
        if (w.gte !== undefined && t < (w.gte instanceof Date ? w.gte.getTime() : new Date(w.gte).getTime())) return false
        if (w.lte !== undefined && t > (w.lte instanceof Date ? w.lte.getTime() : new Date(w.lte).getTime())) return false
        return true
    }
    const chuoiTrongKhoang = (v: string, w: any) => {
        if (!w) return true
        if (w.gte !== undefined && v < w.gte) return false
        if (w.lte !== undefined && v > w.lte) return false
        return true
    }
    const hopTrangThai = (v: any, w: any) => {
        if (w === undefined) return true
        if (typeof w === 'string') return v === w
        if (w.in) return w.in.includes(v)
        return true
    }
    return {
        storeSettings: {
            findFirst: async () => ({ businessType: k.loaiHinh ?? 'company' }),
        },
        journalEntry: {
            findMany: async ({ where }: any = {}) => k.journal.filter(e => chuoiTrongKhoang(e.date, where?.date)),
        },
        transaction: {
            findMany: async ({ where }: any = {}) => k.transactions.filter(t => {
                // Truy vấn tìm bút toán mồ côi lọc theo receiptNumber, không theo ngày
                if (where?.receiptNumber?.in) return where.receiptNumber.in.includes(t.receiptNumber)
                return hopTrangThai(t.status, where?.status) && trongKhoang(t.createdAt, where?.createdAt)
            }),
        },
        chartOfAccount: { findMany: async () => k.chartOfAccounts },
        importReceipt: {
            findMany: async ({ where }: any = {}) => k.imports.filter(i =>
                hopTrangThai(i.status, where?.status)
                && hopTrangThai(i.paymentStatus, where?.paymentStatus)
                && (where?.createdAt ? trongKhoang(i.createdAt, where.createdAt) : true)),
        },
        expense: {
            findMany: async ({ where }: any = {}) => k.expenses.filter(e => trongKhoang(e.date, where?.date)),
        },
        returnOrder: {
            findMany: async ({ where }: any = {}) => k.returns.filter(r =>
                hopTrangThai(r.status, where?.status) && trongKhoang(r.createdAt, where?.createdAt)),
        },
        customer: {
            aggregate: async () => ({ _sum: { debt: k.customers.reduce((s, c) => s + (c.debt || 0), 0) } }),
        },
        product: { findMany: async () => k.products },
        periodLock: { findMany: async () => k.locks },
        inventoryTransaction: {
            findMany: async ({ where }: any = {}) => k.adjustments.filter(a =>
                hopTrangThai(a.type, where?.type) && trongKhoang(a.createdAt, where?.createdAt)),
        },
    }
}

const KHOANG = {
    from: '2026-08-01', to: '2026-08-31',
    start: NGAY('2026-08-01'), end: new Date('2026-09-01T00:00:00.000Z'),
}

/** Cửa hàng SẠCH: mọi nghiệp vụ đều đã có bút toán và số dư khớp thực tế */
function khoSach(): Kho {
    return {
        journal: [
            { reference: 'SALE-HD001', date: '2026-08-05', debitAccount: '111', creditAccount: '511', amount: 1_000_000 },
            { reference: 'IMP-NH001', date: '2026-08-03', debitAccount: '156', creditAccount: '331', amount: 5_000_000 },
            { reference: 'IMPPAY-NH001', date: '2026-08-03', debitAccount: '331', creditAccount: '111', amount: 3_000_000 },
            { reference: 'EXP-e1', date: '2026-08-04', debitAccount: '6421', creditAccount: '111', amount: 500_000 },
            { reference: 'RET-RT001', date: '2026-08-06', debitAccount: '5212', creditAccount: '111', amount: 200_000 },
            // Quỹ tiền mặt: nạp vốn đầu kỳ cho khỏi âm
            { reference: 'OPEN-111', date: '2026-08-01', debitAccount: '111', creditAccount: '411', amount: 10_000_000 },
        ],
        transactions: [{ receiptNumber: 'HD001', total: 1_000_000, status: 'completed', createdAt: NGAY('2026-08-05') }],
        imports: [{ code: 'NH001', totalCost: 5_000_000, paidAmount: 3_000_000, status: 'completed', paymentStatus: 'partial', createdAt: NGAY('2026-08-03') }],
        expenses: [{ id: 'e1', description: 'Thuê mặt bằng', amount: 500_000, status: 'active', date: NGAY('2026-08-04') }],
        returns: [{ code: 'RT001', totalRefund: 200_000, status: 'refunded', createdAt: NGAY('2026-08-06') }],
        customers: [],
        // 156 trên sổ = 5.000.000 → tồn thực tế phải bằng đúng
        products: [{ stock: 50, costPrice: 100_000 }],
        locks: [],
        adjustments: [],
        // Danh mục tài khoản đủ cho các bút toán của cửa hàng mẫu
        chartOfAccounts: ['111', '112', '131', '156', '331', '411', '511', '5212', '632', '6421', '3331'].map(code => ({ code })),
    }
}

let soCa = 0, soLoi = 0
function kiemTra(ten: string, dat: boolean, ghiChu = '') {
    soCa++
    if (dat) console.log(`✓ ${ten}`)
    else { soLoi++; console.log(`✗ ${ten}${ghiChu ? ' — ' + ghiChu : ''}`) }
}
const co = (kq: any, code: string) => kq.vanDe.some((v: any) => v.code === code)
const lay = (kq: any, code: string) => kq.vanDe.find((v: any) => v.code === code)

async function main() {
    // ── 1. Sổ sạch thì phải im lặng ────────────────────────────────────────
    {
        const kq = await soatSoSach(fakePrisma(khoSach()), KHOANG)
        kiemTra('Sổ sạch — không báo vấn đề nào', kq.soVanDe === 0,
            `báo ${kq.soVanDe} vấn đề: ${kq.vanDe.map((v: any) => v.code).join(', ')}`)
    }

    // ── 2. Thiếu bút toán của từng loại nghiệp vụ ──────────────────────────
    {
        const k = khoSach()
        k.journal = k.journal.filter(e => e.reference !== 'SALE-HD001')
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'ban-chua-ghi')
        kiemTra('Bắt được hóa đơn bán chưa vào sổ', !!v && v.soLuong === 1 && v.tien === 1_000_000,
            JSON.stringify(v))
    }
    {
        const k = khoSach()
        k.journal = k.journal.filter(e => !String(e.reference).startsWith('IMP'))
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Bắt được phiếu nhập chưa vào sổ', co(kq, 'nhap-chua-ghi'))
    }
    {
        const k = khoSach()
        k.journal = k.journal.filter(e => e.reference !== 'EXP-e1')
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Bắt được khoản chi chưa vào sổ', co(kq, 'chi-chua-ghi'))
    }
    {
        const k = khoSach()
        k.journal = k.journal.filter(e => e.reference !== 'RET-RT001')
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Bắt được phiếu trả hàng chưa vào sổ', co(kq, 'tra-chua-ghi'))
    }

    // ── 3. Phiếu chi đã HỦY thì không được coi là thiếu ────────────────────
    {
        const k = khoSach()
        k.journal = k.journal.filter(e => e.reference !== 'EXP-e1')
        k.expenses[0]!.status = 'cancelled'
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Phiếu chi đã hủy — không báo thiếu', !co(kq, 'chi-chua-ghi'))
    }

    // ── 4. Bút toán đã bị ĐẢO thì phải coi như chưa ghi ────────────────────
    {
        const k = khoSach()
        k.journal.push({ reference: 'VOID-SALE-HD001', date: '2026-08-07', debitAccount: '511', creditAccount: '111', amount: 1_000_000 })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Bút toán đã đảo — tính là chưa ghi sổ', co(kq, 'ban-chua-ghi'))
    }

    // ── 4b. Điều chỉnh kho chưa vào sổ ─────────────────────────────────────
    {
        const k = khoSach()
        k.adjustments = [{ id: 'adj1', type: 'adjustment', productName: 'Sữa tươi', quantity: -12, createdAt: NGAY('2026-08-09') }]
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'kho-chua-ghi')
        kiemTra('Bắt được điều chỉnh kho chưa vào sổ', !!v && v.soLuong === 1 && kq.thieu.kho === 1, JSON.stringify(v))
    }
    {
        const k = khoSach()
        k.adjustments = [{ id: 'adj1', type: 'adjustment', productName: 'Sữa tươi', quantity: -12, createdAt: NGAY('2026-08-09') }]
        k.journal.push({ reference: 'ADJ-adj1', date: '2026-08-09', debitAccount: '1381', creditAccount: '156', amount: 300_000 })
        // Sổ 156 giảm 300k → tồn thực tế phải giảm theo cho khỏi báo lệch 156
        k.products = [{ stock: 47, costPrice: 100_000 }]
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Điều chỉnh kho đã ghi sổ — không báo thiếu', !co(kq, 'kho-chua-ghi'),
            kq.vanDe.map((v: any) => v.code).join(','))
    }

    // ── 5. Lệch số dư ──────────────────────────────────────────────────────
    {
        const k = khoSach()
        k.customers = [{ debt: 4_000_000 }] // sổ 131 = 0, thực tế nợ 4 triệu
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'lech-131')
        kiemTra('Bắt được lệch phải thu khách hàng (131)', !!v && v.tien === 4_000_000, JSON.stringify(v))
    }
    {
        const k = khoSach()
        // Sổ 331 dư Có 2 triệu; đổi phiếu nhập thành còn nợ 5 triệu → lệch 3 triệu
        k.imports[0]!.paidAmount = 0
        k.imports[0]!.paymentStatus = 'unpaid'
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'lech-331')
        kiemTra('Bắt được lệch phải trả người bán (331)', !!v && v.tien === 3_000_000, JSON.stringify(v))
    }
    {
        const k = khoSach()
        k.products = [{ stock: 20, costPrice: 100_000 }] // tồn thực 2 triệu vs sổ 5 triệu
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'lech-156')
        kiemTra('Bắt được lệch giá trị hàng hóa (156)', !!v && v.tien === 3_000_000, JSON.stringify(v))
    }
    {
        const k = khoSach()
        k.journal = k.journal.filter(e => e.reference !== 'OPEN-111') // bỏ vốn đầu kỳ → quỹ âm
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Bắt được sổ quỹ tiền mặt âm', co(kq, 'quy-am'))
    }

    // ── 5b. Sổ ngân hàng âm ────────────────────────────────────────────────
    {
        const k = khoSach()
        k.journal.push({ reference: 'CHI-NH', date: '2026-08-09', debitAccount: '6421', creditAccount: '112', amount: 20_000_000 })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Bắt sổ tiền gửi ngân hàng âm (mức vừa, vì có thể có thấu chi)',
            co(kq, 'ngan-hang-am') && lay(kq, 'ngan-hang-am').muc === 'vua')
    }

    // ── 5c. Bút toán mồ côi (hóa đơn đã bị xóa) ────────────────────────────
    {
        const k = khoSach()
        k.journal.push({ reference: 'SALE-HD999', date: '2026-08-09', debitAccount: '111', creditAccount: '511', amount: 5_000_000 })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'but-toan-mo-coi')
        kiemTra('Bắt bút toán doanh thu của hóa đơn không còn tồn tại',
            !!v && v.soLuong === 1 && v.viDu[0] === 'HD999', JSON.stringify(v?.viDu))
    }
    {
        const kq = await soatSoSach(fakePrisma(khoSach()), KHOANG)
        kiemTra('Hóa đơn còn nguyên thì không báo mồ côi', !co(kq, 'but-toan-mo-coi'))
    }

    // ── 5d. Tài khoản không có trong hệ thống tài khoản ────────────────────
    {
        const k = khoSach()
        k.journal.push({ reference: 'LA-1', date: '2026-08-09', debitAccount: '9999', creditAccount: '111', amount: 1_000_000 })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'tai-khoan-la')
        kiemTra('Bắt bút toán ghi vào tài khoản lạ', !!v && v.viDu.includes('9999'), JSON.stringify(v?.viDu))
    }
    {
        const k = khoSach()
        // TK chi tiết 131-SHOPEE hợp lệ vì phần gốc 131 có trong danh mục
        k.journal.push({ reference: 'SALE-SPE-1', date: '2026-08-09', debitAccount: '131-SHOPEE', creditAccount: '511', amount: 2_000_000 })
        k.transactions.push({ receiptNumber: 'SPE-1', total: 2_000_000, status: 'completed', createdAt: NGAY('2026-08-09') })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Tài khoản chi tiết 131-SHOPEE không bị coi là lạ', !co(kq, 'tai-khoan-la'),
            JSON.stringify(lay(kq, 'tai-khoan-la')?.viDu))
    }

    // ── 6. Bút toán không hợp lệ ───────────────────────────────────────────
    {
        const k = khoSach()
        k.journal.push({ reference: 'BAD-1', date: '2026-08-08', debitAccount: '111', creditAccount: '111', amount: 100_000 })
        k.journal.push({ reference: 'BAD-2', date: '2026-08-08', debitAccount: '111', creditAccount: '511', amount: 0 })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'but-toan-xau')
        kiemTra('Bắt được bút toán không hợp lệ', !!v && v.soLuong === 2, JSON.stringify(v))
    }

    /* ── 7. Bút toán nằm trong kỳ đã khóa sổ ────────────────────────────────
     *
     * Fixture cũ dùng {year, month, isLocked} — ba trường KHÔNG có trong model
     * PeriodLock. Mã nguồn cũng đọc đúng ba trường đó nên test "đạt", trong khi
     * ngoài đời truy vấn ném P2022 và phép soát chưa từng chạy được lần nào.
     * Bài học: fixture phải theo SCHEMA THẬT, không theo trí nhớ.
     * Model thật: một mốc ngày lockDate + cờ isActive.
     */
    {
        const k = khoSach()
        k.locks = [{ lockDate: '2026-08-31', isActive: true }]
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Bắt được bút toán trong kỳ đã khóa sổ', co(kq, 'ghi-vao-ky-khoa'))
    }
    {
        // Mốc khóa nằm TRƯỚC kỳ đang soát → mọi bút toán đều hợp lệ, phải im
        const k = khoSach()
        k.locks = [{ lockDate: '2026-07-31', isActive: true }]
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Mốc khóa trước kỳ soát thì không kêu', !co(kq, 'ghi-vao-ky-khoa'))
    }
    {
        // Mốc đã bỏ khóa (isActive=false) thì coi như không khóa
        const k = khoSach()
        k.locks = [{ lockDate: '2026-08-31', isActive: false }]
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Mốc đã bỏ khóa thì không kêu', !co(kq, 'ghi-vao-ky-khoa'))
    }
    {
        // Nhiều mốc thì lấy mốc MỚI NHẤT đang hiệu lực
        const k = khoSach()
        k.locks = [
            { lockDate: '2026-06-30', isActive: false },
            { lockDate: '2026-08-31', isActive: true },
        ]
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Lấy mốc khóa mới nhất đang hiệu lực', co(kq, 'ghi-vao-ky-khoa'))
    }

    // ── 8. Xếp mức độ: vấn đề nặng phải nằm trên ───────────────────────────
    {
        const k = khoSach()
        k.journal = k.journal.filter(e => e.reference !== 'SALE-HD001')
        k.journal.push({ reference: 'BAD-1', date: '2026-08-08', debitAccount: '111', creditAccount: '111', amount: 1 })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Vấn đề mức "cao" xếp trước mức "vừa"', kq.vanDe[0]?.muc === 'cao' && kq.soVanDeNang >= 1)
    }

    // ── Sổ hoàn toàn trống là MỘT sự việc, không phải bốn lỗi ──────────────
    /* Bốn phép kiểm "chưa vào sổ" đều hỏi cùng một câu khi sổ chưa có bút toán
     * nào. Để nguyên thì hộ kinh doanh mở trang ra thấy bốn khối đỏ mức CAO cho
     * một việc mà TT 88/2021 KHÔNG bắt buộc họ làm. Menu Kế Toán không có cờ
     * companyOnly nên họ vẫn vào được — phải xử ở đây chứ không giấu trang. */
    {
        const k = khoSach()
        k.journal = []
        k.loaiHinh = 'household'
        const r = await soatSoSach(fakePrisma(k), KHOANG)
        const giaiThich = r.vanDe.find((v: any) => v.code === 'chua-dung-so-kep')
        kiemTra('hộ kinh doanh, sổ trống → có mục giải thích riêng', !!giaiThich)
        kiemTra('… ở mức thấp, không phải cao', giaiThich?.muc === 'thap', giaiThich?.muc)
        kiemTra('… nói rõ TT 88/2021 không bắt buộc sổ kép',
            !!giaiThich && giaiThich.chiTiet.includes('TT 88/2021'))
        const banChuaGhi = r.vanDe.find((v: any) => v.code === 'ban-chua-ghi')
        kiemTra('… và bốn mục "chưa vào sổ" hạ xuống mức thấp',
            !banChuaGhi || banChuaGhi.muc === 'thap', banChuaGhi?.muc)
        kiemTra('… không còn mục nào ở mức cao',
            !r.vanDe.some((v: any) => v.muc === 'cao'),
            r.vanDe.filter((v: any) => v.muc === 'cao').map((v: any) => v.code).join(','))
    }
    {
        // Doanh nghiệp thì sổ trống VẪN là mức cao — có nghĩa vụ kế toán
        const k = khoSach()
        k.journal = []
        k.loaiHinh = 'company'
        const r = await soatSoSach(fakePrisma(k), KHOANG)
        const giaiThich = r.vanDe.find((v: any) => v.code === 'chua-dung-so-kep')
        kiemTra('doanh nghiệp, sổ trống → mức CAO', giaiThich?.muc === 'cao', giaiThich?.muc)
        kiemTra('… nói rõ doanh nghiệp có nghĩa vụ kế toán',
            !!giaiThich && giaiThich.chiTiet.includes('nghĩa vụ kế toán'))
    }
    {
        /* Sổ CÓ bút toán mà sót vài phiếu thì vẫn là mức cao — nới lỏng nhầm
         * chỗ này là bỏ lọt đúng phép kiểm chính của cả module. */
        const k = khoSach()
        k.loaiHinh = 'household'
        k.journal = k.journal.filter((e: any) => !String(e.reference || '').startsWith('SALE-'))
        const r = await soatSoSach(fakePrisma(k), KHOANG)
        const banChuaGhi = r.vanDe.find((v: any) => v.code === 'ban-chua-ghi')
        kiemTra('sổ có ghi mà sót phiếu bán thì VẪN mức cao',
            banChuaGhi?.muc === 'cao', banChuaGhi?.muc)
        kiemTra('… và không kèm mục "chưa dùng sổ kép"',
            !r.vanDe.some((v: any) => v.code === 'chua-dung-so-kep'))
    }

    console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
    process.exit(soLoi > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
