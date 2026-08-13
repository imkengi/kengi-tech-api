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
        journalEntry: {
            findMany: async ({ where }: any = {}) => k.journal.filter(e => chuoiTrongKhoang(e.date, where?.date)),
        },
        transaction: {
            findMany: async ({ where }: any = {}) => k.transactions.filter(t =>
                hopTrangThai(t.status, where?.status) && trongKhoang(t.createdAt, where?.createdAt)),
        },
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

    // ── 6. Bút toán không hợp lệ ───────────────────────────────────────────
    {
        const k = khoSach()
        k.journal.push({ reference: 'BAD-1', date: '2026-08-08', debitAccount: '111', creditAccount: '111', amount: 100_000 })
        k.journal.push({ reference: 'BAD-2', date: '2026-08-08', debitAccount: '111', creditAccount: '511', amount: 0 })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        const v = lay(kq, 'but-toan-xau')
        kiemTra('Bắt được bút toán không hợp lệ', !!v && v.soLuong === 2, JSON.stringify(v))
    }

    // ── 7. Bút toán nằm trong kỳ đã khóa sổ ────────────────────────────────
    {
        const k = khoSach()
        k.locks = [{ year: 2026, month: 8, isLocked: true }]
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Bắt được bút toán trong kỳ đã khóa sổ', co(kq, 'ghi-vao-ky-khoa'))
    }

    // ── 8. Xếp mức độ: vấn đề nặng phải nằm trên ───────────────────────────
    {
        const k = khoSach()
        k.journal = k.journal.filter(e => e.reference !== 'SALE-HD001')
        k.journal.push({ reference: 'BAD-1', date: '2026-08-08', debitAccount: '111', creditAccount: '111', amount: 1 })
        const kq = await soatSoSach(fakePrisma(k), KHOANG)
        kiemTra('Vấn đề mức "cao" xếp trước mức "vừa"', kq.vanDe[0]?.muc === 'cao' && kq.soVanDeNang >= 1)
    }

    console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
    process.exit(soLoi > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
