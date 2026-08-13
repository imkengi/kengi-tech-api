/**
 * Kiểm chứng bút toán tự động phía MUA / CHI PHÍ / TRẢ HÀNG.
 *
 * Chạy:  npx tsx scripts/check-auto-journal.ts
 *
 * Dùng client giả (chỉ ghi vào mảng) nên KHÔNG đụng vào cơ sở dữ liệu nào.
 * Mỗi ca kiểm tra hai thứ:
 *   1. Tổng Nợ = tổng Có (nguyên tắc bút toán kép — sai là sổ vỡ)
 *   2. Số tiền rơi đúng tài khoản kỳ vọng
 */

import {
    postImportReceiptJournal, postExpenseJournal, postReturnJournal, postStockAdjustJournal,
    reverseJournalRefs, refsOfImport,
} from '../src/lib/autoJournalPurchase'

type Entry = {
    date: string; description: string
    debitAccount: string; creditAccount: string
    amount: number; reference: string; referenceType: string
}

function fakeClient() {
    const rows: Entry[] = []
    return {
        rows,
        journalEntry: {
            create: async ({ data }: any) => {
                if (rows.some(r => r.reference === data.reference)) {
                    throw new Error('Unique constraint failed on reference')
                }
                rows.push(data)
                return data
            },
            findMany: async ({ where }: any) => {
                const list: string[] = where?.reference?.in ?? []
                return rows.filter(r => list.includes(r.reference))
            },
        },
    }
}

let soCa = 0, soLoi = 0
const fmt = (v: number) => new Intl.NumberFormat('vi-VN').format(v)

function kiemTra(ten: string, rows: Entry[], kyVong: Record<string, number>) {
    soCa++
    const no: Record<string, number> = {}, co: Record<string, number> = {}
    for (const r of rows) {
        no[r.debitAccount] = (no[r.debitAccount] ?? 0) + r.amount
        co[r.creditAccount] = (co[r.creditAccount] ?? 0) + r.amount
    }
    const tongNo = Object.values(no).reduce((s, v) => s + v, 0)
    const tongCo = Object.values(co).reduce((s, v) => s + v, 0)
    const loi: string[] = []
    if (tongNo !== tongCo) loi.push(`LỆCH CÂN ĐỐI: Nợ ${fmt(tongNo)} ≠ Có ${fmt(tongCo)}`)
    for (const [khoa, mong] of Object.entries(kyVong)) {
        const [ve, tk] = khoa.split(':')
        const thuc = (ve === 'N' ? no : co)[tk!] ?? 0
        if (thuc !== mong) loi.push(`${ve === 'N' ? 'Nợ' : 'Có'} ${tk}: thực ${fmt(thuc)} ≠ kỳ vọng ${fmt(mong)}`)
    }
    if (loi.length) {
        soLoi++
        console.log(`✗ ${ten}`)
        for (const l of loi) console.log(`    ${l}`)
        console.log(`    bút toán: ${rows.map(r => `${r.debitAccount}/${r.creditAccount}=${fmt(r.amount)}`).join(' · ')}`)
    } else {
        console.log(`✓ ${ten}  (Nợ = Có = ${fmt(tongNo)}, ${rows.length} bút toán)`)
    }
}

async function main() {
    const ngay = new Date('2026-08-13T03:00:00Z')

    // ── 1. Nhập hàng, doanh nghiệp khấu trừ VAT, trả trước một phần ─────────
    {
        const c = fakeClient()
        await postImportReceiptJournal(c, {
            code: 'NH-TEST-1', supplierName: 'NCC A',
            totalCost: 10_000_000, vatAmount: 1_000_000,
            shippingFee: 200_000, importTax: 0, otherFees: 0, totalDiscount: 300_000,
            paidAmount: 5_000_000, createdAt: ngay,
        }, { vatKhauTru: true })
        // 156 = 10.000.000 + 200.000 − 300.000 = 9.900.000; 1331 = 1.000.000
        // 331 (Có) = 10.900.000; trả ngay: Nợ 331 5.000.000 / Có 111
        kiemTra('Nhập hàng — DN khấu trừ VAT, trả trước 5 triệu', c.rows, {
            'N:156': 9_900_000, 'N:1331': 1_000_000, 'N:331': 5_000_000,
            'C:331': 10_900_000, 'C:111': 5_000_000,
        })
    }

    // ── 2. Nhập hàng, hộ kinh doanh (VAT vào giá vốn, KHÔNG ghi 1331) ───────
    {
        const c = fakeClient()
        await postImportReceiptJournal(c, {
            code: 'NH-TEST-2', totalCost: 10_000_000, vatAmount: 1_000_000,
            shippingFee: 200_000, totalDiscount: 300_000, paidAmount: 0, createdAt: ngay,
        }, { vatKhauTru: false })
        kiemTra('Nhập hàng — HKD, VAT nằm trong giá vốn', c.rows, {
            'N:156': 10_900_000, 'N:1331': 0, 'C:331': 10_900_000,
        })
    }

    // ── 3. Ghi hai lần cùng một phiếu → không được nhân đôi ────────────────
    {
        const c = fakeClient()
        const r = { code: 'NH-TEST-3', totalCost: 5_000_000, paidAmount: 0, createdAt: ngay }
        await postImportReceiptJournal(c, r as any, { vatKhauTru: true })
        await postImportReceiptJournal(c, r as any, { vatKhauTru: true })
        kiemTra('Nhập hàng — chạy lại lần hai không ghi trùng', c.rows, {
            'N:156': 5_000_000, 'C:331': 5_000_000,
        })
    }

    // ── 4. Chi phí thuê mặt bằng có hóa đơn VAT ────────────────────────────
    {
        const c = fakeClient()
        await postExpenseJournal(c, {
            id: 'e1', description: 'Thuê mặt bằng T8', amount: 11_000_000,
            category: 'rent', date: ngay, vatAmount: 1_000_000, paidBy: 'cash',
        })
        kiemTra('Chi phí thuê mặt bằng — tách VAT khỏi chi phí', c.rows, {
            'N:6421': 10_000_000, 'N:1331': 1_000_000, 'C:111': 11_000_000,
        })
    }

    // ── 5. Trả tiền NCC: là GIẢM NỢ, không phải chi phí ────────────────────
    {
        const c = fakeClient()
        await postExpenseJournal(c, {
            id: 'e2', description: 'Trả tiền NCC A', amount: 5_000_000,
            category: 'supplier_payment', date: ngay, vatAmount: 500_000, paidBy: 'bank',
        })
        kiemTra('Trả tiền NCC — vào 331, không vào 642, bỏ qua VAT', c.rows, {
            'N:331': 5_000_000, 'N:1331': 0, 'N:6428': 0, 'C:112': 5_000_000,
        })
    }

    // ── 6. Chi phí điện (trước đây rơi vào 6428 "CP khác") ─────────────────
    {
        const c = fakeClient()
        await postExpenseJournal(c, {
            id: 'e3', description: 'Tiền điện T8', amount: 2_000_000,
            category: 'electricity', date: ngay, paidBy: 'cash',
        })
        kiemTra('Chi phí điện — vào 6422 CP điện nước', c.rows, {
            'N:6422': 2_000_000, 'C:111': 2_000_000,
        })
    }

    // ── 7. Trả hàng: giảm doanh thu + giảm VAT + nhập lại kho ──────────────
    {
        const c = fakeClient()
        await postReturnJournal(c, {
            code: 'RT-0001', customerName: 'Chị Lan', originalInvoice: 'HD-123',
            totalRefund: 1_100_000, vatAmount: 100_000, costValue: 600_000,
            refundMethod: 'cash', createdAt: ngay,
        })
        // Nợ 5212 1.000.000 + Nợ 3331 100.000 / Có 111 1.100.000
        // Nợ 156 600.000 / Có 632 600.000
        kiemTra('Trả hàng — trả tiền mặt, có nhập lại kho', c.rows, {
            'N:5212': 1_000_000, 'N:3331': 100_000, 'N:156': 600_000,
            'C:111': 1_100_000, 'C:632': 600_000,
        })
    }

    // ── 8. Trả hàng bằng công nợ / đổi hàng: không đụng quỹ tiền ───────────
    {
        const c = fakeClient()
        await postReturnJournal(c, {
            code: 'RT-0002', totalRefund: 500_000, refundMethod: 'store_credit',
            costValue: 0, createdAt: ngay,
        })
        kiemTra('Trả hàng — store credit, không xuất quỹ', c.rows, {
            'N:5212': 500_000, 'C:131': 500_000, 'C:111': 0,
        })
    }

    // ── 9. Đảo bút toán khi hủy phiếu nhập ─────────────────────────────────
    {
        const c = fakeClient()
        await postImportReceiptJournal(c, {
            code: 'NH-TEST-9', totalCost: 3_000_000, vatAmount: 300_000,
            paidAmount: 0, createdAt: ngay,
        } as any, { vatKhauTru: true })
        const daDao = await reverseJournalRefs(c, refsOfImport('NH-TEST-9'))
        const tongNo = c.rows.reduce((s, r) => s + (r.debitAccount === '156' ? r.amount : 0), 0)
        const tongCo = c.rows.reduce((s, r) => s + (r.creditAccount === '156' ? r.amount : 0), 0)
        soCa++
        if (daDao !== 2 || tongNo !== tongCo) {
            soLoi++
            console.log(`✗ Đảo bút toán phiếu nhập — đảo ${daDao} bút toán, 156 Nợ ${fmt(tongNo)} vs Có ${fmt(tongCo)}`)
        } else {
            console.log(`✓ Đảo bút toán phiếu nhập  (đảo ${daDao} bút toán, TK156 về 0)`)
        }
    }

    // ── 10. Kiểm kê THIẾU: Nợ 1381 / Có 156 ───────────────────────────────
    {
        const c = fakeClient()
        await postStockAdjustJournal(c, {
            id: 'adj1', productName: 'Sữa tươi', quantity: -12, costPrice: 25_000,
            reason: 'Kiểm kê tháng 8', date: ngay,
        })
        kiemTra('Kiểm kê thiếu — treo 1381, giảm 156', c.rows, {
            'N:1381': 300_000, 'C:156': 300_000, 'N:632': 0,
        })
    }

    // ── 11. Kiểm kê THỪA: Nợ 156 / Có 3381 ────────────────────────────────
    {
        const c = fakeClient()
        await postStockAdjustJournal(c, {
            id: 'adj2', productName: 'Bánh quy', quantity: 5, costPrice: 40_000, date: ngay,
        })
        kiemTra('Kiểm kê thừa — tăng 156, treo 3381', c.rows, {
            'N:156': 200_000, 'C:3381': 200_000,
        })
    }

    // ── 12. Điều chỉnh 0 hoặc không có giá vốn → không ghi gì ─────────────
    {
        const c = fakeClient()
        await postStockAdjustJournal(c, { id: 'adj3', quantity: 0, costPrice: 25_000, date: ngay })
        await postStockAdjustJournal(c, { id: 'adj4', quantity: -3, costPrice: 0, date: ngay })
        soCa++
        if (c.rows.length !== 0) { soLoi++; console.log(`✗ Điều chỉnh 0 / thiếu giá vốn — không được ghi bút toán (đã ghi ${c.rows.length})`) }
        else console.log('✓ Điều chỉnh 0 hoặc thiếu giá vốn — không ghi bút toán rác')
    }

    console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
    process.exit(soLoi > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
