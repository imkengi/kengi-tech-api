// ─────────────────────────────────────────────────────────────────────────────
//  Chart of Accounts — Thong tu 99/2025/TT-BTC (unified, effective 01/01/2026)
//
//  TT99/2025 replaces BOTH TT200/2014 and TT133/2016 with a single accounting
//  regime for every enterprise. The account numbering is largely inherited from
//  TT200, so existing ledgers keep working; this seed is the canonical, unified
//  account list a retail business needs.
//
//  Shared by:
//    - src/routes/tax.ts        (POST /api/tax/chart-of-accounts/seed)
//    - src/routes/accounts.ts   (GET/POST/PUT/DELETE /api/accounts)
// ─────────────────────────────────────────────────────────────────────────────

export const COA_CIRCULAR = 'TT99/2025/TT-BTC'

export interface CoaSeedAccount {
    code: string
    name: string
    nameEn?: string
    level: number
    parentCode?: string
    type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense' | 'OffBalance'
    nature: 'Debit' | 'Credit'
    description?: string
}

export const COA_SEED: CoaSeedAccount[] = [
    // ─── Loai 1: Tai san ngan han (Current assets) ──────────────────────────────
    { code: '111', name: 'Tien mat', nameEn: 'Cash on hand', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1111', name: 'Tien Viet Nam', nameEn: 'Cash in VND', level: 2, parentCode: '111', type: 'Asset', nature: 'Debit' },
    { code: '1112', name: 'Ngoai te', nameEn: 'Cash in foreign currency', level: 2, parentCode: '111', type: 'Asset', nature: 'Debit' },
    { code: '112', name: 'Tien gui ngan hang', nameEn: 'Cash in bank', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1121', name: 'Tien VND tai ngan hang', nameEn: 'Bank VND', level: 2, parentCode: '112', type: 'Asset', nature: 'Debit' },
    { code: '1122', name: 'Ngoai te tai ngan hang', nameEn: 'Bank foreign currency', level: 2, parentCode: '112', type: 'Asset', nature: 'Debit' },
    { code: '121', name: 'Chung khoan kinh doanh', nameEn: 'Trading securities', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '128', name: 'Dau tu nam giu den ngay dao han', nameEn: 'Held-to-maturity investments', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '131', name: 'Phai thu khach hang', nameEn: 'Trade receivables', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '133', name: 'Thue GTGT duoc khau tru', nameEn: 'VAT deductible', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1331', name: 'Thue GTGT duoc khau tru cua HHDV', nameEn: 'VAT deductible of goods/services', level: 2, parentCode: '133', type: 'Asset', nature: 'Debit' },
    { code: '1332', name: 'Thue GTGT duoc khau tru cua TSCD', nameEn: 'VAT deductible of fixed assets', level: 2, parentCode: '133', type: 'Asset', nature: 'Debit' },
    { code: '136', name: 'Phai thu noi bo', nameEn: 'Intra-company receivables', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '138', name: 'Phai thu khac', nameEn: 'Other receivables', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '141', name: 'Tam ung', nameEn: 'Advances to employees', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '142', name: 'Chi phi tra truoc ngan han', nameEn: 'Short-term prepaid expenses', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '151', name: 'Hang mua dang di duong', nameEn: 'Goods in transit', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '152', name: 'Nguyen lieu, vat lieu', nameEn: 'Raw materials', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '153', name: 'Cong cu, dung cu', nameEn: 'Tools and supplies', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '154', name: 'Chi phi san xuat, kinh doanh do dang', nameEn: 'Work in progress', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '155', name: 'Thanh pham', nameEn: 'Finished goods', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '156', name: 'Hang hoa', nameEn: 'Merchandise', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '157', name: 'Hang gui di ban', nameEn: 'Goods on consignment', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '159', name: 'Du phong giam gia hang ton kho', nameEn: 'Provision for inventory devaluation', level: 1, type: 'Asset', nature: 'Credit' },

    // ─── Loai 2: Tai san dai han (Non-current assets) ───────────────────────────
    { code: '211', name: 'Tai san co dinh huu hinh', nameEn: 'Tangible fixed assets', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '212', name: 'Tai san co dinh thue tai chinh', nameEn: 'Finance leased assets', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '213', name: 'Tai san co dinh vo hinh', nameEn: 'Intangible fixed assets', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '214', name: 'Hao mon tai san co dinh', nameEn: 'Accumulated depreciation', level: 1, type: 'Asset', nature: 'Credit' },
    { code: '217', name: 'Bat dong san dau tu', nameEn: 'Investment property', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '221', name: 'Dau tu vao cong ty con', nameEn: 'Investment in subsidiaries', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '228', name: 'Dau tu dai han khac', nameEn: 'Other long-term investments', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '229', name: 'Du phong ton that tai san', nameEn: 'Provision for asset loss', level: 1, type: 'Asset', nature: 'Credit' },
    { code: '241', name: 'Xay dung co ban do dang', nameEn: 'Construction in progress', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '242', name: 'Chi phi tra truoc', nameEn: 'Prepaid expenses', level: 1, type: 'Asset', nature: 'Debit' },

    // ─── Loai 3: No phai tra (Liabilities) ──────────────────────────────────────
    { code: '331', name: 'Phai tra cho nguoi ban', nameEn: 'Trade payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '333', name: 'Thue va cac khoan phai nop Nha nuoc', nameEn: 'Taxes and statutory payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3331', name: 'Thue GTGT phai nop', nameEn: 'VAT payable', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '33311', name: 'Thue GTGT dau ra', nameEn: 'Output VAT', level: 3, parentCode: '3331', type: 'Liability', nature: 'Credit' },
    { code: '33312', name: 'Thue GTGT hang nhap khau', nameEn: 'Import VAT', level: 3, parentCode: '3331', type: 'Liability', nature: 'Credit' },
    { code: '3332', name: 'Thue tieu thu dac biet', nameEn: 'Special consumption tax', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3333', name: 'Thue xuat, nhap khau', nameEn: 'Import/export duties', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3334', name: 'Thue thu nhap doanh nghiep', nameEn: 'Corporate income tax payable', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3335', name: 'Thue thu nhap ca nhan', nameEn: 'Personal income tax payable', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3338', name: 'Thue va cac khoan phai nop khac', nameEn: 'Other taxes payable', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '334', name: 'Phai tra nguoi lao dong', nameEn: 'Payables to employees', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '335', name: 'Chi phi phai tra', nameEn: 'Accrued expenses', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '336', name: 'Phai tra noi bo', nameEn: 'Intra-company payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '338', name: 'Phai tra, phai nop khac', nameEn: 'Other payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3382', name: 'Kinh phi cong doan', nameEn: 'Trade union fund', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3383', name: 'Bao hiem xa hoi', nameEn: 'Social insurance', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3384', name: 'Bao hiem y te', nameEn: 'Health insurance', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3386', name: 'Bao hiem that nghiep', nameEn: 'Unemployment insurance', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '341', name: 'Vay va no thue tai chinh', nameEn: 'Borrowings and finance lease liabilities', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '352', name: 'Du phong phai tra', nameEn: 'Provisions for payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '353', name: 'Quy khen thuong, phuc loi', nameEn: 'Bonus and welfare fund', level: 1, type: 'Liability', nature: 'Credit' },

    // ─── Loai 4: Von chu so huu (Equity) ────────────────────────────────────────
    { code: '411', name: 'Von dau tu cua chu so huu', nameEn: "Owner's capital", level: 1, type: 'Equity', nature: 'Credit' },
    { code: '413', name: 'Chenh lech ty gia hoi doai', nameEn: 'FX differences', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '414', name: 'Quy dau tu phat trien', nameEn: 'Investment & development fund', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '418', name: 'Cac quy khac thuoc von chu so huu', nameEn: 'Other equity funds', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '419', name: 'Co phieu quy', nameEn: 'Treasury shares', level: 1, type: 'Equity', nature: 'Debit' },
    { code: '421', name: 'Loi nhuan sau thue chua phan phoi', nameEn: 'Retained earnings', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '4211', name: 'LNST chua phan phoi nam truoc', nameEn: 'Retained earnings - prior years', level: 2, parentCode: '421', type: 'Equity', nature: 'Credit' },
    { code: '4212', name: 'LNST chua phan phoi nam nay', nameEn: 'Retained earnings - current year', level: 2, parentCode: '421', type: 'Equity', nature: 'Credit' },

    // ─── Loai 5: Doanh thu (Revenue) ────────────────────────────────────────────
    { code: '511', name: 'Doanh thu ban hang va cung cap dich vu', nameEn: 'Sales revenue', level: 1, type: 'Revenue', nature: 'Credit' },
    { code: '5111', name: 'Doanh thu ban hang hoa', nameEn: 'Goods sales revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '5112', name: 'Doanh thu ban thanh pham', nameEn: 'Finished goods revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '5113', name: 'Doanh thu cung cap dich vu', nameEn: 'Service revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '515', name: 'Doanh thu hoat dong tai chinh', nameEn: 'Financial income', level: 1, type: 'Revenue', nature: 'Credit' },
    { code: '521', name: 'Cac khoan giam tru doanh thu', nameEn: 'Sales deductions', level: 1, type: 'Revenue', nature: 'Debit' },
    { code: '5211', name: 'Chiet khau thuong mai', nameEn: 'Trade discounts', level: 2, parentCode: '521', type: 'Revenue', nature: 'Debit' },
    { code: '5212', name: 'Hang ban bi tra lai', nameEn: 'Sales returns', level: 2, parentCode: '521', type: 'Revenue', nature: 'Debit' },
    { code: '5213', name: 'Giam gia hang ban', nameEn: 'Sales allowances', level: 2, parentCode: '521', type: 'Revenue', nature: 'Debit' },

    // ─── Loai 6: Chi phi san xuat, kinh doanh (Costs/Expenses) ──────────────────
    { code: '611', name: 'Mua hang', nameEn: 'Purchases', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '621', name: 'Chi phi nguyen lieu, vat lieu truc tiep', nameEn: 'Direct material cost', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '622', name: 'Chi phi nhan cong truc tiep', nameEn: 'Direct labor cost', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '627', name: 'Chi phi san xuat chung', nameEn: 'Manufacturing overhead', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '632', name: 'Gia von hang ban', nameEn: 'Cost of goods sold', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '635', name: 'Chi phi tai chinh', nameEn: 'Financial expenses', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '641', name: 'Chi phi ban hang', nameEn: 'Selling expenses', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '642', name: 'Chi phi quan ly doanh nghiep', nameEn: 'General & administration expenses', level: 1, type: 'Expense', nature: 'Debit' },

    // ─── Loai 7/8: Thu nhap khac, Chi phi khac (Other income/expenses) ──────────
    { code: '711', name: 'Thu nhap khac', nameEn: 'Other income', level: 1, type: 'Revenue', nature: 'Credit' },
    { code: '811', name: 'Chi phi khac', nameEn: 'Other expenses', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '821', name: 'Chi phi thue thu nhap doanh nghiep', nameEn: 'Corporate income tax expense', level: 1, type: 'Expense', nature: 'Debit' },

    // ─── Loai 9: Xac dinh ket qua kinh doanh (Income summary) ───────────────────
    { code: '911', name: 'Xac dinh ket qua kinh doanh', nameEn: 'Income summary', level: 1, type: 'Equity', nature: 'Debit' },

    // ─── Tai khoan ngoai bang (Off-balance-sheet) ──────────────────────────────
    { code: '001', name: 'Tai san thue ngoai', nameEn: 'Leased assets (off-balance)', level: 1, type: 'OffBalance', nature: 'Debit' },
]

// Fast lookup: account code → display name (Vietnamese)
const NAME_BY_CODE = new Map<string, string>(COA_SEED.map(a => [a.code, a.name]))

/** Return the canonical Vietnamese name for an account code, or the code itself. */
export function accountName(code: string): string {
    return NAME_BY_CODE.get(code) || code
}

/** Classify an account into balance-sheet / P&L groups by its leading digit. */
export function classifyAccount(code: string): 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'other' {
    switch (code.charAt(0)) {
        case '1':
        case '2': return 'asset'
        case '3': return 'liability'
        case '4': return 'equity'
        case '5': return 'revenue'
        case '6':
        case '8': return 'expense'
        case '7': return 'revenue'
        default: return 'other'
    }
}
