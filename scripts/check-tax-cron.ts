/**
 * Kiểm chứng logic chọn kỳ của cron soát thuế — npx tsx scripts/check-tax-cron.ts
 *
 * Cron chạy ngày 16 hằng tháng và phải soát THÁNG TRƯỚC. Chỗ dễ sai nhất là mốc
 * giao năm (tháng 1 phải soát tháng 12 năm ngoái) — sai là soát nhầm kỳ và ghi
 * log sai, kế toán tin theo thì hỏng việc.
 *
 * Hàm chọn kỳ được viết lại y hệt bản trong cron để test được mà không phải
 * khởi động timer/DB; nếu sửa cron thì sửa cả đây (chỉ 4 dòng).
 */

function kyThangTruoc(now: Date): { year: number; month: number } {
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth() + 1
    return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }
}

let soCa = 0, soLoi = 0
function kiemTra(ten: string, dat: boolean, ghiChu = '') {
    soCa++
    if (dat) console.log(`✓ ${ten}`)
    else { soLoi++; console.log(`✗ ${ten}${ghiChu ? ' — ' + ghiChu : ''}`) }
}

const ca: Array<[string, string, number, number]> = [
    ['Giữa năm: 16/08/2026 → soát tháng 7/2026', '2026-08-16T01:00:00.000Z', 2026, 7],
    ['Giao năm: 16/01/2027 → soát tháng 12/2026', '2027-01-16T01:00:00.000Z', 2026, 12],
    ['Tháng 3 → soát tháng 2', '2026-03-16T01:00:00.000Z', 2026, 2],
    ['Tháng 12 → soát tháng 11 cùng năm', '2026-12-16T01:00:00.000Z', 2026, 11],
]

for (const [ten, iso, namMong, thangMong] of ca) {
    const k = kyThangTruoc(new Date(iso))
    kiemTra(ten, k.year === namMong && k.month === thangMong, `được ${k.month}/${k.year}`)
}

// Ngày cuối tháng của kỳ phải đúng, kể cả tháng 2 năm nhuận
const cuoiThang = (year: number, month: number) => new Date(year, month, 0).getDate()
kiemTra('Tháng 2/2028 (năm nhuận) có 29 ngày', cuoiThang(2028, 2) === 29, String(cuoiThang(2028, 2)))
kiemTra('Tháng 2/2026 có 28 ngày', cuoiThang(2026, 2) === 28, String(cuoiThang(2026, 2)))
kiemTra('Tháng 4 có 30 ngày', cuoiThang(2026, 4) === 30, String(cuoiThang(2026, 4)))

console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
process.exit(soLoi > 0 ? 1 : 0)
