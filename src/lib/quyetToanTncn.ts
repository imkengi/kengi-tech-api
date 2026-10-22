// ─────────────────────────────────────────────────────────────────────────────
//  QUYẾT TOÁN THUẾ TNCN NĂM (05/QTT-TNCN) — tách khỏi routes/tax.ts (22/10/2026)
//
//  Trang Kế Toán Lương (GET /api/tax/pit-settlement/*) và công cụ AI tax_pit (routes/mcpTaxTools)
//  dùng CHUNG một bộ tính: AI không được nói số khác màn hình chủ shop đang xem.
// ─────────────────────────────────────────────────────────────────────────────

// Tính thuế TNCN cuối năm cho từng nhân viên từ PayrollRecord.
// Biểu lũy tiến từng phần 5%→35% theo Luật thuế TNCN.
// Mức giảm trừ: bản thân 11tr/tháng (NĐ44/2023), phụ thuộc 4.4tr/tháng/người.

export const PIT_FORM_TYPE = '05_QTT_TNCN'
export const PIT_SELF_DEDUCTION_PER_MONTH = 11_000_000
export const PIT_DEPENDENT_DEDUCTION_PER_MONTH = 4_400_000

// Biểu thuế lũy tiến từng phần — annual brackets (VND), Vietnamese PIT law
export const PIT_BRACKETS_ANNUAL: { upTo: number; rate: number }[] = [
    { upTo: 60_000_000, rate: 0.05 },
    { upTo: 120_000_000, rate: 0.10 },
    { upTo: 216_000_000, rate: 0.15 },
    { upTo: 384_000_000, rate: 0.20 },
    { upTo: 624_000_000, rate: 0.25 },
    { upTo: 960_000_000, rate: 0.30 },
    { upTo: Infinity, rate: 0.35 },
]

export function calculatePitProgressive(taxableIncome: number): number {
    if (taxableIncome <= 0) return 0
    let tax = 0
    let prevCap = 0
    for (const b of PIT_BRACKETS_ANNUAL) {
        const slice = Math.min(taxableIncome, b.upTo) - prevCap
        if (slice <= 0) break
        tax += slice * b.rate
        prevCap = b.upTo
        if (taxableIncome <= b.upTo) break
    }
    return Math.round(tax)
}

export interface PitEmployeeBreakdown {
    employeeId: string
    employeeCode: string | null
    name: string
    department: string | null
    monthsWorked: number
    totalIncome: number          // Tổng thu nhập chịu thuế
    totalInsurance: number       // BHXH + BHYT + BHTN (phần NLĐ) — khấu trừ trước thuế
    selfDeduction: number        // Giảm trừ bản thân
    dependentDeduction: number   // Giảm trừ người phụ thuộc
    deductions: number           // Tổng giảm trừ (BH + bản thân + phụ thuộc)
    taxableIncome: number        // Thu nhập tính thuế
    taxAmount: number            // Thuế TNCN phải nộp theo biểu lũy tiến
    pitWithheld: number          // Thuế TNCN đã khấu trừ trong năm (sum monthly pit)
    balanceDue: number           // taxAmount - pitWithheld (>0: nộp thêm, <0: hoàn)
}

export function aggregatePitByEmployee(records: any[]): PitEmployeeBreakdown[] {
    const byEmp = new Map<string, any[]>()
    for (const r of records) {
        const key = r.employeeId || r.employeeName
        if (!key) continue
        if (!byEmp.has(key)) byEmp.set(key, [])
        byEmp.get(key)!.push(r)
    }

    const result: PitEmployeeBreakdown[] = []
    for (const [employeeId, recs] of byEmp.entries()) {
        const sample = recs[0]
        let totalIncome = 0
        let totalInsurance = 0
        let dependentMonths = 0
        let pitWithheld = 0
        const monthsSeen = new Set<number>()
        for (const r of recs) {
            const gross = Number(r.actualGross) || Number(r.grossSalary) || 0
            const bonus = Number(r.bonus) || 0
            // actualGross may or may not already include bonus depending on how payroll was entered.
            // If actualGross < grossSalary, treat bonus as not yet rolled in.
            const hasBonusInActual = gross >= Number(r.grossSalary || 0)
            totalIncome += gross + (hasBonusInActual ? 0 : bonus)
            totalInsurance += (Number(r.bhxh_emp) || 0) + (Number(r.bhyt_emp) || 0) + (Number(r.bhtn_emp) || 0)
            dependentMonths += Number(r.dependents) || 0
            pitWithheld += Number(r.pit) || 0
            if (typeof r.month === 'number') monthsSeen.add(r.month)
        }
        const monthsWorked = monthsSeen.size || recs.length
        const selfDeduction = monthsWorked * PIT_SELF_DEDUCTION_PER_MONTH
        const dependentDeduction = dependentMonths * PIT_DEPENDENT_DEDUCTION_PER_MONTH
        const deductions = totalInsurance + selfDeduction + dependentDeduction
        const taxableIncome = Math.max(0, totalIncome - deductions)
        const taxAmount = calculatePitProgressive(taxableIncome)
        result.push({
            employeeId,
            employeeCode: sample.employeeCode || null,
            name: sample.employeeName || '',
            department: sample.department || null,
            monthsWorked,
            totalIncome: Math.round(totalIncome),
            totalInsurance: Math.round(totalInsurance),
            selfDeduction,
            dependentDeduction,
            deductions: Math.round(deductions),
            taxableIncome: Math.round(taxableIncome),
            taxAmount,
            pitWithheld: Math.round(pitWithheld),
            balanceDue: taxAmount - Math.round(pitWithheld),
        })
    }
    result.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    return result
}

export function pitSummary(employees: PitEmployeeBreakdown[]) {
    return {
        totalEmployees: employees.length,
        totalIncome: employees.reduce((s, e) => s + e.totalIncome, 0),
        totalDeductions: employees.reduce((s, e) => s + e.deductions, 0),
        totalTaxableIncome: employees.reduce((s, e) => s + e.taxableIncome, 0),
        totalTax: employees.reduce((s, e) => s + e.taxAmount, 0),
        totalWithheld: employees.reduce((s, e) => s + e.pitWithheld, 0),
        totalBalanceDue: employees.reduce((s, e) => s + e.balanceDue, 0),
    }
}

// Parse the structured PIT payload we store inside TaxDeclaration.notes.
// Returns null if notes is plain text (legacy / user-entered) rather than our JSON envelope.
export function parsePitNotes(notes: string | null | undefined): { userNotes?: string; employees?: PitEmployeeBreakdown[]; summary?: any } | null {
    if (!notes) return null
    try {
        const obj = JSON.parse(notes)
        if (obj && obj.__pit === true) return obj
        return null
    } catch { return null }
}

/** Bảng quyết toán TNCN của năm y như GET /api/tax/pit-settlement/:year/employees: bản ĐÃ LƯU
 *  (TaxDeclaration period QTT-<năm>) nếu có, không thì TÍNH từ PayrollRecord. */
export async function docQuyetToanTncn(prisma: any, year: number) {
    const decl = await prisma.taxDeclaration.findUnique({ where: { period: `QTT-${year}` } })
    const parsed = decl ? parsePitNotes(decl.notes) : null
    if (parsed?.employees) {
        return {
            year,
            source: 'saved' as const,
            declarationId: decl.id as string,
            status: decl.status as string,
            summary: parsed.summary || pitSummary(parsed.employees),
            employees: parsed.employees,
        }
    }
    const records = await prisma.payrollRecord.findMany({
        where: { year },
        orderBy: [{ employeeName: 'asc' }, { month: 'asc' }],
    })
    const employees = aggregatePitByEmployee(records)
    return {
        year,
        source: 'calculated' as const,
        summary: pitSummary(employees),
        employees,
    }
}
