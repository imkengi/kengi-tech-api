// ─────────────────────────────────────────────────────────────────────────────
//  TỜ KHAI GTGT 01/GTGT — số tự tính từ sổ cái (Có 3331 = đầu ra, Nợ 133 = đầu vào)
//  Tách khỏi routes/taxDeclarations.ts (22/10/2026): trang Tờ Khai GTGT (GET /api/tax/vat-return)
//  và công cụ AI tax_vat_return (routes/mcpTaxTools) dùng CHUNG một hàm.
// ─────────────────────────────────────────────────────────────────────────────

export const pad2 = (n: number) => String(n).padStart(2, '0')

// ─── Period helpers ──────────────────────────────────────────────────────────

// Resolve month|quarter|year into an inclusive YYYY-MM-DD string range, a Date
// range (for createdAt filters), and the HTKK period label / type.
export function resolvePeriod(q: any): {
    gte: string; lte: string; start: Date; end: Date
    year: number; month?: number; quarter?: number
    periodType: 'month' | 'quarter' | 'year'; period: string
} {
    const year = Number(q.year) || new Date().getFullYear()
    const month = q.month ? Number(q.month) : undefined
    const quarter = q.quarter ? Number(q.quarter) : undefined

    if (month) {
        const last = new Date(year, month, 0).getDate()
        return {
            gte: `${year}-${pad2(month)}-01`, lte: `${year}-${pad2(month)}-${pad2(last)}`,
            start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59, 999),
            year, month, periodType: 'month', period: `${pad2(month)}/${year}`,
        }
    }
    if (quarter) {
        const startM = (quarter - 1) * 3 + 1
        const endM = startM + 2
        const last = new Date(year, endM, 0).getDate()
        return {
            gte: `${year}-${pad2(startM)}-01`, lte: `${year}-${pad2(endM)}-${pad2(last)}`,
            start: new Date(year, startM - 1, 1), end: new Date(year, endM, 0, 23, 59, 59, 999),
            year, quarter, periodType: 'quarter', period: `Q${quarter}/${year}`,
        }
    }
    return {
        gte: `${year}-01-01`, lte: `${year}-12-31`,
        start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999),
        year, periodType: 'year', period: `${year}`,
    }
}

export type Entry = { debitAccount: string; creditAccount: string; amount: number }
export const sideSum = (entries: Entry[], prefix: string, s: 'debit' | 'credit') =>
    entries.reduce((t, e) => {
        const code = s === 'debit' ? e.debitAccount : e.creditAccount
        return code && code.startsWith(prefix) ? t + e.amount : t
    }, 0)

/** Số liệu tờ khai 01/GTGT của một kỳ (?month=&year= hoặc ?quarter=&year=, không có thì cả năm) —
 *  đúng dữ liệu GET /api/tax/vat-return trả cho trang Tờ Khai GTGT. */
export async function tinhToKhaiGtgt(prisma: any, q: any) {
    const p = resolvePeriod(q)
    // Đọc sổ hỏng thì NÉM (route trả 500, AI báo chưa đọc được) — bản cũ nuốt thành [] nên
    // tờ khai hiện "phải nộp 0đ" như thật (cùng họ lỗi "đọc hỏng ≠ bằng 0", 20/08/2026).
    const entries: Entry[] = await prisma.journalEntry.findMany({
        where: { date: { gte: p.gte, lte: p.lte } },
        select: { debitAccount: true, creditAccount: true, amount: true },
    })

    // VAT output = Có 3331 (net of any reversals on the debit side).
    const outputVat = sideSum(entries, '3331', 'credit') - sideSum(entries, '3331', 'debit')
    // VAT input = Nợ 133 (net of any reversals on the credit side).
    const inputVat = sideSum(entries, '133', 'debit') - sideSum(entries, '133', 'credit')
    const vatPayable = outputVat - inputVat

    return {
        form: '01/GTGT',
        title: 'Tờ khai thuế giá trị gia tăng',
        period: p.period,
        periodType: p.periodType,
        year: p.year, month: p.month ?? null, quarter: p.quarter ?? null,
        outputVat: Math.round(outputVat),
        inputVat: Math.round(inputVat),
        vatPayable: Math.round(Math.max(vatPayable, 0)),
        vatCarryForward: Math.round(Math.max(-vatPayable, 0)), // [43] thuế GTGT còn được khấu trừ
    }
}
