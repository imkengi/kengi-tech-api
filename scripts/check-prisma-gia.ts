/**
 * Kiểm ĐỘ TRUNG THỰC CỦA PRISMA GIẢ — npx tsx scripts/check-prisma-gia.ts
 *
 * Một prisma giả trả CÙNG MỘT SHAPE cho MỌI câu SQL thô là cái bẫy tệ nhất
 * trong bộ test: phép soát mới thêm vào sẽ nhận dữ liệu của phép soát cũ, im
 * lặng báo "ổn", và test xanh mà KHÔNG HỀ chạy qua mã mới. Test kiểu đó tệ hơn
 * không có test, vì nó cho cảm giác an toàn.
 *
 * DÍNH BA LẦN ngày 14–15/08/2026:
 *   - check-data-health: `$queryRawUnsafe: async () => [{soNgay,…}]` → phép soát
 *     "kỳ ghi sổ lệch kỳ bán" nhận về shape của phép đếm ngày, ra tổng 0, báo
 *     "ổn". Xanh 54/54 mà không kiểm gì.
 *   - check-revenue-reconcile: fake chỉ nhìn `where.createdAt`; sau khi lib đổi
 *     sang dạng `OR` thì trường đó là undefined → BỘ LỌC NGÀY BIẾN MẤT, mọi ca
 *     đều "đạt".
 *   - check-tax-audit: `$queryRawUnsafe: async () => banVuot` → phép đo mốc
 *     bán/nhập đầu tiên nhận nhầm mảng, chốt chặn không chạy.
 *
 * LUẬT (hẹp, đo được 0 báo động giả): thư viện nào có TỪ HAI câu `$queryRawUnsafe`
 * trở lên thì prisma giả của nó BẮT BUỘC phân nhánh theo câu SQL — tức hàm phải
 * NHẬN tham số. Thư viện chỉ có một câu thì bỏ qua tham số là vô hại.
 */

import * as fs from 'fs'
import * as path from 'path'

/** lib → file test tương ứng. Thêm cặp mới khi thêm cỗ máy mới. */
const CAP: Array<{ lib: string; test: string }> = [
    { lib: 'dataHealth.ts', test: 'check-data-health.ts' },
    { lib: 'reorderPlan.ts', test: 'check-reorder-plan.ts' },
    { lib: 'taxAudit.ts', test: 'check-tax-audit.ts' },
    { lib: 'cashForecast.ts', test: 'check-cash-forecast.ts' },
    { lib: 'revenueReconcile.ts', test: 'check-revenue-reconcile.ts' },
    { lib: 'hkdTransition.ts', test: 'check-hkd-transition.ts' },
    { lib: 'growthOpportunity.ts', test: 'check-growth-opportunity.ts' },
    { lib: 'reconcile.ts', test: 'check-reconcile.ts' },
    { lib: 'taxAssessment.ts', test: 'check-tax-assessment.ts' },
    { lib: 'auditDrill.ts', test: 'check-audit-drill.ts' },
    { lib: 'auditPack.ts', test: 'check-audit-pack.ts' },
    { lib: 'stockTrace.ts', test: 'check-stock-trace.ts' },
]

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const doc = (p: string) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }

function main() {
    console.log('\n▶ Prisma giả phải phân nhánh khi lib có nhiều câu SQL thô\n')

    const thieuCap: string[] = []
    const viPham: string[] = []
    let soCanKiem = 0

    for (const { lib, test } of CAP) {
        const nguon = doc(path.join('src/lib', lib))
        const bo = doc(path.join('scripts', test))
        if (nguon === null || bo === null) { thieuCap.push(`${lib} ↔ ${test}`); continue }

        const soSql = (nguon.match(/\$queryRawUnsafe/g) || []).length
        if (soSql < 2) continue          // một câu thì bỏ qua tham số là vô hại
        soCanKiem++

        /* Prisma giả CHÍNH (khai trong hàm dựng) phải nhận tham số sql. Bản ghi
         * đè theo từng ca test thì không xét — chúng cố ý thu hẹp cho một ca. */
        const chinh = /\$queryRawUnsafe:\s*async\s*\(\s*(sql|_sql)/.test(bo)
        if (!chinh) viPham.push(`${test} (lib ${lib} có ${soSql} câu SQL thô)`)
    }

    ok('mọi cặp lib/test khai trong bảng đều tồn tại', thieuCap.length === 0, thieuCap)
    ok('lib nhiều câu SQL thô đều có prisma giả phân nhánh', viPham.length === 0, viPham)
    ok('bảng cặp có phủ được thư viện cần kiểm (bộ dò còn sống)',
        soCanKiem >= 3, soCanKiem)

    // Chiều ngược: phải BẮT được một prisma giả dễ dãi
    const gia = '        $queryRawUnsafe: async () => [{ soNgay: 90 }],'
    ok('bắt được prisma giả bỏ qua tham số sql',
        !/\$queryRawUnsafe:\s*async\s*\(\s*(sql|_sql)/.test(gia), gia.trim())

    console.log(`\n  Đã kiểm ${soCanKiem} thư viện có từ 2 câu SQL thô trở lên.`)
    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
