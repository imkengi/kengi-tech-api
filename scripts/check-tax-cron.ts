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

/* ── Thông báo tự động ────────────────────────────────────────────────────────
 * Cron mà chỉ ghi log thì vẫn câm. Nhưng kêu mỗi tháng cũng hỏng: thành tiếng
 * ồn rồi bị bỏ qua đúng lúc cần nghe. Nên kiểm cả hai chiều — có dấu hiệu nặng
 * thì PHẢI báo, không có thì PHẢI im.
 */
async function kiemThongBao() {
    const { soatChoStore } = await import('../src/cron/taxAuditCron')

    const dungKho = (journal: any[], declaration: any, invoices: any[] = []) => {
        const daTao: any[] = []
        const chuoi = (v: string, w: any) => {
            if (!w) return true
            if (w.gte !== undefined && v < w.gte) return false
            if (w.lte !== undefined && v > w.lte) return false
            if (w.lt !== undefined && !(v < w.lt)) return false
            return true
        }
        const prisma: any = {
            journalEntry: { findMany: async ({ where }: any = {}) => journal.filter(e => chuoi(e.date, where?.date)) },
            taxDeclaration: { findFirst: async () => declaration, findMany: async () => (declaration ? [declaration] : []) },
            eInvoice: { findMany: async () => invoices },
            expense: { findMany: async () => [] },
            importReceipt: { findMany: async () => [] },
            product: { findMany: async () => [] },
            transaction: { findMany: async () => [] },
            taxDeadline: { findMany: async () => [] },
            payrollPeriod: { findMany: async () => [] },
            payrollEntry: { findMany: async () => [] },
            employee: { findMany: async () => [] },
            storeSettings: { findFirst: async () => ({ businessType: 'company' }) },
            hkdRevenueEntry: { findMany: async () => [] },
            $queryRawUnsafe: async () => [],
            taxAuditLog: { create: async () => ({}) },
            notification: { create: async (a: any) => { daTao.push(a.data); return {} } },
        }
        return { prisma, daTao }
    }

    // Sổ có doanh thu nhưng tờ khai bỏ trống 100tr → cảnh báo mức cao
    const lech = dungKho([
        { date: '2026-07-05', debitAccount: '111', creditAccount: '511', amount: 100_000_000 },
        { date: '2026-07-05', debitAccount: '111', creditAccount: '3331', amount: 10_000_000 },
    ], { period: '2026-07', ct29: 0, ct30: 0, ct33: 0 })
    await soatChoStore(lech.prisma, 'Cửa hàng test', 2026, 7)
    kiemTra('Có dấu hiệu rủi ro cao thì đẩy thông báo', lech.daTao.length === 1,
        JSON.stringify(lech.daTao))
    const tb = lech.daTao[0] || {}
    kiemTra('Thông báo đúng loại tax-audit', tb.type === 'tax-audit', String(tb.type))
    kiemTra('Tiêu đề nêu kỳ và số dấu hiệu',
        /tháng 7\/2026/.test(String(tb.title)) && /dấu hiệu/.test(String(tb.title)), String(tb.title))
    kiemTra('Nội dung nêu điểm sẵn sàng', /Điểm sẵn sàng \d+\/100/.test(String(tb.message)), String(tb.message))
    kiemTra('Nội dung nhắc lợi ích khai bổ sung trước hạn',
        /khai bổ sung/.test(String(tb.message)), String(tb.message))

    /* Sổ khớp tờ khai → phải im. Lưu ý: phần lớn doanh thu phải qua NGÂN HÀNG,
     * vì tỉ trọng tiền mặt ≥85% tự nó là một dấu hiệu rủi ro cao — fixture toàn
     * tiền mặt sẽ kêu và làm ta tưởng phép báo bị sai. */
    const sach = dungKho([
        { date: '2026-07-05', debitAccount: '112', creditAccount: '511', amount: 80_000_000 },
        { date: '2026-07-05', debitAccount: '112', creditAccount: '3331', amount: 8_000_000 },
        { date: '2026-07-06', debitAccount: '111', creditAccount: '511', amount: 20_000_000 },
        { date: '2026-07-06', debitAccount: '111', creditAccount: '3331', amount: 2_000_000 },
    ], { period: '2026-07', ct29: 100_000_000, ct30: 10_000_000, ct33: 0 }, [
        {
            invoiceNumber: '1', invoiceSymbol: '1C26TAA', invoiceDate: '2026-07-05',
            invoiceType: 'SALE', status: 'SIGNED', createdAt: new Date('2026-07-05'),
            totalBeforeVat: 100_000_000, vatAmount: 10_000_000, totalAmount: 110_000_000,
            buyerName: 'Công ty A', buyerTaxCode: '0101234567', paymentMethod: 'CK',
            transactionId: null, items: [],
        },
    ])
    await soatChoStore(sach.prisma, 'Cửa hàng sạch', 2026, 7)
    kiemTra('Không có dấu hiệu nặng thì KHÔNG báo', sach.daTao.length === 0,
        JSON.stringify(sach.daTao.map((t: any) => t.title)))

    // Kỳ trống trơn → không ghi gì cả
    const trong = dungKho([], null)
    await soatChoStore(trong.prisma, 'Cửa hàng chưa bán', 2026, 7)
    kiemTra('Kỳ không phát sinh thì không báo', trong.daTao.length === 0)

    // Bảng Notification chưa có (store cũ chưa migrate) → không được ném lỗi
    const thieuBang = dungKho([
        { date: '2026-07-05', debitAccount: '111', creditAccount: '511', amount: 100_000_000 },
    ], { period: '2026-07', ct29: 0, ct30: 0, ct33: 0 })
    thieuBang.prisma.notification = {
        create: async () => { throw new Error('The table `Notification` does not exist') },
    }
    let neLoi = true
    try { await soatChoStore(thieuBang.prisma, 'Store cũ', 2026, 7) } catch { neLoi = false }
    kiemTra('Thiếu bảng Notification thì bỏ qua, không kéo sập vòng chạy', neLoi)
}

kiemThongBao().then(() => {
    console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
    process.exit(soLoi > 0 ? 1 : 0)
}).catch(e => { console.error(e); process.exit(1) })
