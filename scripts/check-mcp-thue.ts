/**
 * Kiểm CÔNG CỤ AI THUẾ — npx tsx scripts/check-mcp-thue.ts
 *
 * Chủ shop 22/10/2026: "giờ qua làm MCP thuế để hỏi trợ lý AI đi". Năm công cụ mới (routes/mcpTaxTools)
 * gọi CHUNG hàm với màn hình Thuế (lib/toKhaiGtgt, lib/lichNghiaVuThue, lib/quyetToanTncn, export của
 * routes/einvoice). Bộ này canh:
 *   · số AI đọc = số hàm của màn hình tính (prisma giả, KHÔNG chạm DB), đọc hỏng thì NÉM chứ không ra 0
 *   · route màn hình thật sự gọi đúng hàm dùng chung (soát mã nguồn) — tách lib mà route vẫn tự tính là lệch
 *   · chế độ "Hỏi AI về thuế" (mcp-agent chuDe='thue') chỉ nạp công cụ thuế + sổ sách, không công cụ ghi
 *   · cảnh báo mức giảm trừ TNCN cũ cho năm ≥ 2026 (NQ 110/2025/UBTVQH15) không bị nuốt
 */
import fs from 'fs'
import path from 'path'
import { TOOLS } from '../src/routes/mcp'
import { TAX_TOOLS, TEN_TOOL_THUE } from '../src/routes/mcpTaxTools'
import { ToolError } from '../src/lib/mcpTypes'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe).slice(0, 600)}` : ''}`) }
}

/** Prisma giả: mỗi bảng khai từng hàm, chưa khai thì NÉM để lộ ca chưa phủ; `$…` là hàm cấp gốc. */
function gia(cauHinh: Record<string, any>) {
    const bang = (ten: string) => new Proxy({}, {
        get: (_t, ph: string) => async (...args: any[]) => {
            const fn = cauHinh?.[ten]?.[ph]
            if (!fn) throw new Error(`mock thiếu ${ten}.${ph}`)
            return typeof fn === 'function' ? fn(...args) : fn
        },
    })
    return new Proxy({}, {
        get: (_t, ten: string) => {
            if (ten.startsWith('$')) {
                const fn = cauHinh[ten]
                if (!fn) return async () => { throw new Error(`mock thiếu ${ten}`) }
                return fn
            }
            return bang(ten)
        },
    })
}
const loiThieuBang = () => Object.assign(new Error('relation "EInvoice" does not exist'), { code: 'P2010' })
const loiMatKetNoi = () => Object.assign(new Error('P1001: mất kết nối'), { code: 'P1001' })
const ctx = (prisma: any) => ({ prisma, scopes: 'read', storeCode: 'THU' })
const tool = (ten: string) => TAX_TOOLS.find(t => t.name === ten)!
const nemKhong = async (f: () => Promise<any>) => { try { await f(); return null } catch (e) { return e } }

/** Hồ sơ thuế: suyHoSoThue đọc storeSettings + tờ khai đã lập (đa số tháng/quý) + payrollEntry.count */
const hoSo = (businessType: string, kieu: 'month' | 'quarter') => ({
    storeSettings: { findFirst: async () => ({ businessType }) },
    payrollEntry: { count: async () => 0 },
    kieu,
})

async function main() {
    console.log('\n▶ Công cụ AI thuế (mcpTaxTools)\n')

    /* 1 — đăng ký */
    const tenTools = new Set(TOOLS.map(t => t.name))
    ok('1a. 5 công cụ thuế mới có trong bộ MCP chung (trợ lý dashboard + AI ngoài cùng thấy)',
        ['tax_vat_return', 'tax_deadlines', 'einvoice_status', 'tax_stock', 'tax_pit'].every(n => tenTools.has(n)) && TAX_TOOLS.length === 5)
    ok('1b. không công cụ thuế nào là công cụ GHI', TAX_TOOLS.every(t => !t.write))
    const thieu = TEN_TOOL_THUE.filter(n => !tenTools.has(n))
    ok('1c. mọi tên trong bộ "Hỏi AI về thuế" đều tồn tại (gõ sai tên = công cụ lặng lẽ biến mất)', thieu.length === 0, thieu)
    ok('1d. bộ "Hỏi AI về thuế" không chứa công cụ ghi', TOOLS.filter(t => TEN_TOOL_THUE.includes(t.name)).every(t => !t.write))
    ok('1e. không trùng tên', new Set(TEN_TOOL_THUE).size === TEN_TOOL_THUE.length && new Set(TOOLS.map(t => t.name)).size === TOOLS.length)
    ok('1f. bộ thuế gồm cả soát thanh tra, sổ sách và data_health_check',
        ['tax_audit_check', 'tax_reconcile_3way', 'accounting_ledger', 'data_health_check'].every(n => TEN_TOOL_THUE.includes(n)))

    /* 2 — tờ khai GTGT */
    {
        let kyDoc: any = null
        let kySoTk: any = null
        const butToan = [
            { debitAccount: '131', creditAccount: '3331', amount: 1_000_000 },   // đầu ra
            { debitAccount: '3331', creditAccount: '131', amount: 100_000 },     // đảo một phần đầu ra
            { debitAccount: '1331', creditAccount: '331', amount: 300_000 },     // đầu vào
        ]
        let thamSoSql: any[] = []
        const p = (businessType = 'company', kieu: 'month' | 'quarter' = 'month', but = butToan,
            ban: any = { n: 12, dt: 9_900_000, thue: 900_000 }, hd: any = { n: 12, truoc: 9_000_000, thue: 900_000 }) => gia({
            ...hoSo(businessType, kieu),
            $queryRawUnsafe: async (sql: string, ...ps: any[]) => {
                thamSoSql = ps
                if (/FROM "Transaction"/.test(sql)) { if (ban instanceof Error) throw ban; return [ban] }
                if (/FROM "EInvoice"/.test(sql)) { if (hd instanceof Error) throw hd; return [hd] }
                throw new Error(`SQL lạ chưa khai trong mock: ${sql.slice(0, 60)}`)
            },
            taxDeclaration: {
                findMany: async (a: any) => {
                    if (a?.where?.formType) return Array.from({ length: 3 }, () => ({ periodType: kieu }))
                    kySoTk = a?.where?.period?.contains
                    return [{ formType: '01_GTGT', period: 'T09/2025', status: 'submitted', ct38: 500_000, cnkdTotalTax: 0, filedAt: new Date('2025-10-15'), createdAt: new Date('2025-10-10') }]
                },
            },
            journalEntry: { findMany: async (a: any) => { kyDoc = a?.where?.date; return but } },
        })
        const kq: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p()))
        ok('2a. tháng 9/2025: đầu ra 900k (đã trừ đảo), đầu vào 300k, phải nộp 600k',
            kq.ky === 'tháng 9/2025' && kq.thueDauRa === 900_000 && kq.thueDauVaoDuocKhauTru === 300_000 && kq.phaiNop === 600_000 && kq.conDuocKhauTruChuyenKySau === 0, kq)
        ok('2b. đọc đúng khoảng sổ của kỳ', kyDoc?.gte === '2025-09-01' && kyDoc?.lte === '2025-09-30', kyDoc)
        ok('2c. tra tờ khai đã lập theo mã kỳ ĐÚNG cách lưu (T09/2025, có số 0)', kySoTk === 'T09/2025', kySoTk)
        ok('2d. kèm tờ khai đã lập: số trên tờ khai + đã nộp', kq.toKhaiDaLap?.[0]?.soPhaiNopTrenToKhai === 500_000 && kq.toKhaiDaLap?.[0]?.trangThai === 'submitted', kq.toKhaiDaLap)
        ok('2e. kỳ đã qua ⇒ KHÔNG gắn "tạm tính"', !('tamTinh' in kq))
        const kqLai: any = await tool('tax_vat_return').run({ year: 2099, month: 1 }, ctx(p()))
        ok('2f. kỳ chưa kết thúc ⇒ có "tạm tính"', typeof kqLai.tamTinh === 'string')
        const kqKhauTru: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('company', 'month', [{ debitAccount: '1331', creditAccount: '331', amount: 700_000 }, { debitAccount: '131', creditAccount: '3331', amount: 200_000 }])))
        ok('2g. đầu vào > đầu ra ⇒ phải nộp 0, còn được khấu trừ 500k', kqKhauTru.phaiNop === 0 && kqKhauTru.conDuocKhauTruChuyenKySau === 500_000, kqKhauTru)
        // Không nói kỳ ⇒ kỳ đang diễn ra theo cách cửa hàng kê khai
        const nay = new Date(Date.now() + 7 * 3600_000)
        const kqThang: any = await tool('tax_vat_return').run({}, ctx(p('company', 'month')))
        ok('2h. bỏ trống kỳ, khai theo THÁNG ⇒ tháng hiện tại', kqThang.ky === `tháng ${nay.getUTCMonth() + 1}/${nay.getUTCFullYear()}` && kqThang.cuaHangKeKhaiTheo === 'tháng', kqThang.ky)
        const kqQuy: any = await tool('tax_vat_return').run({}, ctx(p('company', 'quarter')))
        ok('2i. bỏ trống kỳ, khai theo QUÝ ⇒ quý hiện tại', kqQuy.ky === `quý ${Math.ceil((nay.getUTCMonth() + 1) / 3)}/${nay.getUTCFullYear()}`, kqQuy.ky)
        const kqNam: any = await tool('tax_vat_return').run({ year: 2025 }, ctx(p()))
        ok('2j. chỉ truyền năm ⇒ cả năm (không tra tờ khai theo kỳ)', kqNam.ky === 'năm 2025' && Array.isArray(kqNam.toKhaiDaLap) && kqNam.toKhaiDaLap.length === 0, kqNam.ky)
        const kqHo: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('household')))
        ok('2k. hộ kinh doanh ⇒ nhắc khai trên doanh thu (01/CNKD)', typeof kqHo.luuYHoKinhDoanh === 'string' && kqHo.loaiHinh === 'hộ kinh doanh')
        const loi = await nemKhong(() => tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(gia({
            ...hoSo('company', 'month'),
            taxDeclaration: { findMany: async (a: any) => a?.where?.formType ? [{ periodType: 'month' }] : [] },
            journalEntry: { findMany: async () => { throw loiMatKetNoi() } },
        }))))
        ok('2l. đọc sổ HỎNG ⇒ NÉM, không trả "phải nộp 0đ"', loi instanceof Error, String(loi))
        ok('2m. đối chiếu cắt đúng kỳ (tham số SQL = ngày đầu/cuối kỳ)', thamSoSql[0] === '2025-09-01' && thamSoSql[1] === '2025-09-30', thamSoSql)
        ok('2n. sổ khớp hoá đơn ⇒ KHÔNG cảnh báo, có số đối chiếu', !('canhBaoSoChuaGhi' in kq) && !('canhBaoLechHoaDon' in kq)
            && kq.doiChieu?.phieuBanTrongKy?.doanhThu === 9_900_000 && kq.doiChieu?.hoaDonDienTuDaGuiCqt?.thueGtgt === 900_000, kq.doiChieu)
        const kqSoTrong: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('company', 'month', [])))
        ok('2o. ĐO THẬT 22/10 (KENGISTORE): sổ không có thuế đầu ra mà kỳ có bán hàng ⇒ canhBaoSoChuaGhi ĐẦU object, cấm nói "không phải nộp"',
            kqSoTrong.phaiNop === 0 && typeof kqSoTrong.canhBaoSoChuaGhi === 'string' && /SỔ CHƯA GHI/.test(kqSoTrong.canhBaoSoChuaGhi)
            && Object.keys(kqSoTrong)[0] === 'canhBaoSoChuaGhi', Object.keys(kqSoTrong))
        const kqKhongBan: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('company', 'month', [], { n: 0, dt: 0, thue: 0 }, { n: 0, truoc: 0, thue: 0 })))
        ok('2p. kỳ KHÔNG bán gì, sổ 0 ⇒ không cảnh báo oan', !('canhBaoSoChuaGhi' in kqKhongBan), Object.keys(kqKhongBan))
        const kqLech: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('company', 'month', butToan, undefined, { n: 30, truoc: 20_000_000, thue: 2_000_000 })))
        ok('2q. thuế trên sổ (900k) lệch hoá đơn đã gửi CQT (2tr) ⇒ canhBaoLechHoaDon', typeof kqLech.canhBaoLechHoaDon === 'string', Object.keys(kqLech))
        const kqKhongHd: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('company', 'month', butToan, undefined, Object.assign(new Error('relation "EInvoice" does not exist'), { code: 'P2010' }))))
        ok('2r. cửa hàng chưa dùng HĐĐT ⇒ hoaDon null, không báo lỗi', kqKhongHd.doiChieu?.hoaDonDienTuDaGuiCqt === null && !kqKhongHd.doiChieu?.loi, kqKhongHd.doiChieu)
        const kqLoiBan: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('company', 'month', butToan, Object.assign(new Error('P1001: mất kết nối'), { code: 'P1001' }))))
        ok('2s. đọc phiếu bán hỏng ⇒ vẫn trả tờ khai + nói rõ lỗi đối chiếu (không lặng lẽ coi là 0)', kqLoiBan.phaiNop === 600_000 && /không đọc được phiếu bán/.test(kqLoiBan.doiChieu?.loi || ''), kqLoiBan.doiChieu)
        const kqHdBan: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('company', 'month', [],
            { n: 3328, dt: 1_504_331_793, thue: 0 }, { n: 3250, truoc: 1_506_662_481, thue: 0 })))
        ok('2t. ĐO THẬT KENGISTORE 22/10: HĐĐT gửi CQT đều thuế 0đ ⇒ HOÁ ĐƠN BÁN HÀNG (trực tiếp/HKD): 01/GTGT KHÔNG áp dụng — KHÔNG buộc tội "sổ chưa ghi"',
            Object.keys(kqHdBan)[0] === 'canhBaoKhongApDung' && /HOÁ ĐƠN BÁN HÀNG/.test(kqHdBan.canhBaoKhongApDung) && /TUYỆT ĐỐI không nói/.test(kqHdBan.canhBaoKhongApDung)
            && !('canhBaoSoChuaGhi' in kqHdBan) && /Cài đặt cửa hàng/.test(kqHdBan.canhBaoKhongApDung), Object.keys(kqHdBan))
        const kqHoHdBan: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('household', 'month', [],
            { n: 10, dt: 5_000_000, thue: 0 }, { n: 10, truoc: 5_000_000, thue: 0 })))
        ok('2u. hộ kinh doanh xuất hoá đơn bán hàng ⇒ không bảo sửa loại hình', typeof kqHoHdBan.canhBaoKhongApDung === 'string' && !/Cài đặt cửa hàng/.test(kqHoHdBan.canhBaoKhongApDung))
        const kqKhongHdCoBan: any = await tool('tax_vat_return').run({ year: 2025, month: 9 }, ctx(p('company', 'month', [],
            { n: 50, dt: 20_000_000, thue: 0 }, { n: 0, truoc: 0, thue: 0 })))
        ok('2v. có bán, sổ 0, KHÔNG có hoá đơn nào ⇒ "chưa xác định được", không kết luận gì',
            Object.keys(kqKhongHdCoBan)[0] === 'canhBaoChuaRo' && /CHƯA xác định/.test(kqKhongHdCoBan.canhBaoChuaRo) && !('canhBaoSoChuaGhi' in kqKhongHdCoBan), Object.keys(kqKhongHdCoBan))
    }

    /* 3 — lịch nghĩa vụ + số dư */
    {
        const ymd = (d: Date) => d.toISOString().slice(0, 10)
        const sau = (n: number) => ymd(new Date(Date.now() + n * 86_400_000))
        const nam = new Date().getFullYear()
        let docDanhSach = 0, danhDauQuaHan = 0
        const p = gia({
            ...hoSo('company', 'month'),
            taxDeclaration: {
                findMany: async (a: any) => {
                    if (a?.where?.formType) return [{ periodType: 'month' }, { periodType: 'month' }]
                    return []   // tờ khai của năm (gắn tiền) — chưa lập
                },
            },
            taxDeadline: {
                upsert: async () => ({}),
                deleteMany: async () => ({ count: 0 }),
                updateMany: async () => { danhDauQuaHan++; return { count: 0 } },
                findMany: async (a: any) => {
                    if (!a?.orderBy) return []   // bước dọn mốc thừa
                    docDanhSach++
                    return [
                        { id: '1', taxType: 'VAT', period: `T01/${nam}`, dueDate: sau(-5), status: 'overdue', description: 'Tờ khai GTGT tháng 1' },
                        { id: '2', taxType: 'VAT', period: `T02/${nam}`, dueDate: sau(3), status: 'pending', description: 'Tờ khai GTGT tháng 2' },
                        { id: '3', taxType: 'VAT', period: `T03/${nam}`, dueDate: sau(40), status: 'pending', description: 'Tờ khai GTGT tháng 3' },
                        { id: '4', taxType: 'LICENSE', period: `${nam}`, dueDate: sau(-60), status: 'submitted', description: 'Lệ phí môn bài' },
                    ]
                },
            },
            payrollPeriod: { findMany: async () => [] },
            journalEntry: {
                findMany: async (a: any) => {
                    if (a?.where?.date?.gte) return []   // doanh thu năm / quý để ước tính tiền mốc
                    return [   // số dư tới hết năm
                        { debitAccount: '131', creditAccount: '33311', amount: 700_000 },
                        { debitAccount: '33311', creditAccount: '112', amount: 200_000 },
                        { debitAccount: '642', creditAccount: '3335', amount: 100_000 },
                    ]
                },
            },
        })
        const kq: any = await tool('tax_deadlines').run({}, ctx(p))
        ok('3a. chia đúng: 1 quá hạn · 1 sắp đến hạn (≤7 ngày) · 1 sắp tới · 1 đã nộp',
            kq.quaHan?.length === 1 && kq.sapDenHan?.length === 1 && kq.sapToi?.length === 1 && kq.soMocDaNop === 1 && kq.tongSoMoc === 4, kq)
        ok('3b. mốc quá hạn giữ số ngày âm + mô tả', kq.quaHan?.[0]?.conNgay < 0 && kq.quaHan?.[0]?.viec === 'Tờ khai GTGT tháng 1', kq.quaHan?.[0])
        ok('3c. số dư trên sổ: GTGT 500k, TNCN 100k, tổng 600k',
            kq.soDuThuePhaiNopTrenSo?.gtgt === 500_000 && kq.soDuThuePhaiNopTrenSo?.tncn === 100_000 && kq.soDuThuePhaiNopTrenSo?.tong === 600_000, kq.soDuThuePhaiNopTrenSo)
        ok('3d. chạy y như mở trang: đánh dấu quá hạn + đọc danh sách đúng 1 lần', danhDauQuaHan === 1 && docDanhSach === 1, { danhDauQuaHan, docDanhSach })
        ok('3e. số tiền chưa suy ra được giữ null (không quy về 0) + có ghi chú nói rõ',
            kq.sapToi?.[0] && (kq.sapToi[0].soTien === null || typeof kq.sapToi[0].soTien === 'number') && /KHÔNG phải không phải nộp/.test(kq.ghiChu), kq.sapToi?.[0])
    }

    /* 4 — TNCN */
    {
        const ban = (ten: string, thang: number, gross: number, pit: number, dependents = 0) => ({
            employeeId: ten, employeeName: ten, employeeCode: `NV-${ten}`, department: null, year: 2025, month: thang,
            grossSalary: gross, actualGross: gross, bonus: 0, bhxh_emp: 0, bhyt_emp: 0, bhtn_emp: 0, dependents, pit,
        })
        const p = (records: any[], saved: any = null) => gia({
            taxDeclaration: { findUnique: async () => saved },
            payrollRecord: { findMany: async () => records },
        })
        const records = [
            ...Array.from({ length: 12 }, (_, i) => ban('An', i + 1, 30_000_000, 1_000_000)),
            ...Array.from({ length: 12 }, (_, i) => ban('Binh', i + 1, 9_000_000, 0)),
        ]
        const kq: any = await tool('tax_pit').run({ year: 2025 }, ctx(p(records)))
        ok('4a. tự tính từ bảng lương: 2 nhân viên, nguồn "tự tính"', kq.tongHop?.soNhanVien === 2 && /tự tính/.test(kq.nguon), kq.tongHop)
        ok('4b. người lệch nhiều nhất lên đầu (An)', kq.nhanVien?.[0]?.ten === 'An', kq.nhanVien?.map((n: any) => n.ten))
        ok('4c. năm 2025 dùng mức cũ là ĐÚNG ⇒ không cảnh báo', !('canhBaoMucGiamTru' in kq))
        const kq26: any = await tool('tax_pit').run({ year: 2026 }, ctx(p(records)))
        ok('4d. năm 2026 mà bộ tính còn mức cũ ⇒ CẢNH BÁO nêu mức mới 15.500.000đ / 6.200.000đ (NQ 110/2025)',
            typeof kq26.canhBaoMucGiamTru === 'string' && /15\.500\.000/.test(kq26.canhBaoMucGiamTru) && /6\.200\.000/.test(kq26.canhBaoMucGiamTru) && /110\/2025/.test(kq26.canhBaoMucGiamTru), kq26.canhBaoMucGiamTru)
        const saved = { id: 'd1', status: 'submitted', notes: JSON.stringify({ __pit: true, employees: [{ employeeId: 'x', employeeCode: null, name: 'Chi', department: null, monthsWorked: 12, totalIncome: 1, totalInsurance: 0, selfDeduction: 0, dependentDeduction: 0, deductions: 0, taxableIncome: 1, taxAmount: 0, pitWithheld: 0, balanceDue: 0 }], summary: { totalEmployees: 1, totalIncome: 1, totalDeductions: 0, totalTaxableIncome: 1, totalTax: 0, totalWithheld: 0, totalBalanceDue: 0 } }) }
        const kqLuu: any = await tool('tax_pit').run({ year: 2025 }, ctx(p([], saved)))
        ok('4e. có bản quyết toán đã lưu ⇒ đọc bản đó + trạng thái', /đã lưu/.test(kqLuu.nguon) && kqLuu.trangThaiBanDaLuu === 'submitted' && kqLuu.nhanVien?.[0]?.ten === 'Chi', kqLuu)
        const nhieu = Array.from({ length: 25 }, (_, k) => ban(`N${k}`, 1, 20_000_000 + k * 1_000_000, 0))
        const kqNhieu: any = await tool('tax_pit').run({ year: 2025 }, ctx(p(nhieu)))
        ok('4f. 25 nhân viên ⇒ danh sách 20 + cảnh báo đừng tự cộng (tổng vẫn đủ 25)',
            kqNhieu.nhanVien?.length === 20 && typeof kqNhieu.ghiChuDanhSach === 'string' && kqNhieu.tongHop?.soNhanVien === 25, { n: kqNhieu.nhanVien?.length, tong: kqNhieu.tongHop?.soNhanVien })
    }

    /* 5 — tồn kho thuế */
    {
        let thamSo: any[] = []
        const rows = [
            { sku: 'a', name: 'Quạt A', nhapVat: 5, xuat: 8, traLai: 0, ton: -3 },
            { sku: 'b', name: 'Quạt B', nhapVat: 2, xuat: 3, traLai: 0, ton: -1 },
            { sku: 'c', name: 'Quạt C', nhapVat: 9, xuat: 5, traLai: 0, ton: 4 },
        ]
        const p = (kq: any) => gia({ $queryRawUnsafe: async (_sql: string, ...ps: any[]) => { thamSo = ps; if (kq instanceof Error) throw kq; return kq } })
        const kq: any = await tool('tax_stock').run({}, ctx(p(rows)))
        ok('5a. 2 mã âm, tổng âm 4 cái, mã âm nhiều nhất lên đầu', kq.soMaAm === 2 && kq.tongSoLuongAm === 4 && kq.maAmNhieuNhat?.[0]?.sku === 'a' && kq.maAmNhieuNhat.length === 2, kq)
        const kqTim: any = await tool('tax_stock').run({ q: 'Quạt C' }, ctx(p([rows[2]])))
        ok('5b. tìm theo tên ⇒ truyền xuống SQL (chữ thường) + trả dòng khớp kể cả tồn dương', thamSo[0] === 'quạt c' && kqTim.ketQua?.[0]?.ton === 4, { thamSo, kq: kqTim.ketQua })
        const kqChua: any = await tool('tax_stock').run({}, ctx(p(loiThieuBang())))
        ok('5c. chưa có bảng ⇒ báo "chưa có dữ liệu", không nổ', typeof kqChua.ghiChu === 'string')
        const loi = await nemKhong(() => tool('tax_stock').run({}, ctx(p(loiMatKetNoi()))))
        ok('5d. đọc hỏng ⇒ ToolError (AI báo không đọc được, không nói "không mã nào âm")', loi instanceof ToolError, String(loi))
    }

    /* 6 — hoá đơn điện tử */
    {
        const sqlDaChay: string[] = []
        const p = (hong?: Error) => gia({
            eInvoiceConfig: { findFirst: async () => ({ id: 'c1', provider: 'vnpt', extra: JSON.stringify({ autoIssueOnDelivery: true, autoIssueSince: '2026-10-01T00:00:00.000Z' }) }) },
            $queryRawUnsafe: async (sql: string) => {
                sqlDaChay.push(sql)
                if (hong) throw hong
                if (/JOIN "ReturnOrder" ro/.test(sql)) return [
                    { invoiceSymbol: 'C26TAA', invoiceNumber: '00012', receiptNumber: 'ONLINE-SPE-1', returnCode: 'RTN-SH-1', refundAmount: 100_000, totalAmount: 100_000, txTotal: 100_000 },
                    { invoiceSymbol: 'C26TAA', invoiceNumber: '00013', receiptNumber: 'ONLINE-SPE-2', returnCode: 'RTN-SH-2', refundAmount: 30_000, totalAmount: 100_000, txTotal: 100_000 },
                ]
                if (/to_char\(/.test(sql)) return [{ day: '2026-10-21', n: 3, amount: 900_000, returns: 0 }, { day: '2026-10-20', n: 2, amount: 400_000, returns: 1 }]
                if (/GROUP BY 1 ORDER BY 2 DESC/.test(sql)) return [{ platform: 'shopee', n: 4, amount: 1_000_000 }, { platform: 'tiktok', n: 1, amount: 300_000 }]
                if (/COUNT\(\*\) FILTER/.test(sql)) return [{ n: 5, amount: 1_300_000, returns: 1 }]
                throw new Error(`SQL lạ chưa khai trong mock: ${sql.slice(0, 80)}`)
            },
            eInvoice: {
                count: async (a: any) => a?.where?.status === 'SENT' ? 90 : a?.where?.status === 'ERROR' ? 10 : 0,
                findMany: async () => [{ errorMessage: 'Sai MST người mua', createdAt: new Date('2026-10-20'), totalAmount: 250_000, transactionId: 't1' }],
            },
            transaction: { findMany: async () => [{ id: 't1', receiptNumber: 'ONLINE-SPE-9' }] },
        })
        const kq: any = await tool('einvoice_status').run({}, ctx(p()))
        ok('6a. hàng đợi tính từ MỐC BẬT tự xuất (y như trang): từ 2026-10-01, 5 phiếu, 1.300.000đ',
            kq.hangDoiChoXuat?.tinhTu === '2026-10-01' && kq.hangDoiChoXuat?.soPhieu === 5 && kq.hangDoiChoXuat?.tongTien === 1_300_000, kq.hangDoiChoXuat)
        ok('6b. theo sàn + theo ngày gần nhất', kq.hangDoiChoXuat?.theoSan?.[0]?.san === 'shopee' && kq.hangDoiChoXuat?.theoNgayGanNhat?.[0]?.ngay === '2026-10-21')
        ok('6c. lịch sử 30 ngày: 90 đã gửi, 10 lỗi, tỷ lệ lỗi 10%, lỗi gần nhất kèm số phiếu',
            kq.lichSuXuat?.daGuiCoQuanThue === 90 && kq.lichSuXuat?.loi === 10 && kq.lichSuXuat?.tyLeLoi === '10%' && kq.lichSuXuat?.loiGanNhat?.[0]?.phieu === 'ONLINE-SPE-9', kq.lichSuXuat)
        ok('6d. hoá đơn cần điều chỉnh: 2 cái, 1 trả toàn bộ nên thay thế', kq.canDieuChinh?.soHoaDon === 2 && kq.canDieuChinh?.traToanBoNenThayThe === 1 && kq.canDieuChinh?.mau?.[0]?.hoaDon === 'C26TAA 00012', kq.canDieuChinh)
        ok('6e. cấu hình: nhà cung cấp + đang tự xuất', kq.cauHinh?.nhaCungCap === 'vnpt' && kq.cauHinh?.tuXuatKhiGiaoHang === true)
        const kqChua: any = await tool('einvoice_status').run({}, ctx(p(loiThieuBang())))
        ok('6f. chưa có bảng hoá đơn ⇒ "chưa bật hoá đơn điện tử", không nổ', kqChua.daDungHoaDonDienTu === false)
        const loi = await nemKhong(() => tool('einvoice_status').run({}, ctx(p(loiMatKetNoi()))))
        ok('6g. đọc hỏng ⇒ ToolError, không báo "0 hoá đơn lỗi"', loi instanceof ToolError, String(loi))
        ok('6h. KHÔNG có câu ghi nào (chỉ SELECT)', sqlDaChay.every(s => !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(s)))
    }

    /* 7 — route màn hình gọi ĐÚNG hàm dùng chung (soát mã nguồn) */
    {
        const doc = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
        const khuc = (nguon: string, dau: string) => {
            const i = nguon.indexOf(dau)
            if (i < 0) return ''
            const j = nguon.indexOf('\nrouter.', i + 10)
            return nguon.slice(i, j < 0 ? undefined : j)
        }
        const tax = doc('routes/tax.ts'), khai = doc('routes/taxDeclarations.ts'), hd = doc('routes/einvoice.ts'), ag = doc('routes/mcpAgent.ts')
        ok('7a. /tax/deadlines gọi docLichNghiaVu(prisma, req.query)', khuc(tax, "router.get('/deadlines',").includes('docLichNghiaVu(prisma, req.query)'))
        ok('7b. /tax/reports/tax-obligations gọi soDuThuePhaiNop', khuc(tax, "router.get('/reports/tax-obligations',").includes('soDuThuePhaiNop(prisma, year)'))
        ok('7c. /tax/pit-settlement/:year/employees gọi docQuyetToanTncn', khuc(tax, "router.get('/pit-settlement/:year/employees',").includes('docQuyetToanTncn(prisma, year)'))
        ok('7d. tax.ts không còn bản sao bộ tính TNCN (đã chuyển sang lib)', !/function aggregatePitByEmployee|const PIT_BRACKETS_ANNUAL/.test(tax))
        ok('7e. /tax/vat-return gọi tinhToKhaiGtgt', khuc(khai, "router.get('/vat-return',").includes('tinhToKhaiGtgt(prisma, req.query)'))
        ok('7f. /einvoice/tax-stock gọi tonKhoThue', khuc(hd, "router.get('/tax-stock',").includes('tonKhoThue(prisma,'))
        ok('7g. /einvoice/needs-adjust gọi hoaDonCanDieuChinh', khuc(hd, "router.get('/needs-adjust',").includes('hoaDonCanDieuChinh(prisma)'))
        ok('7h. /einvoice/queue/history đếm bằng demXuatHoaDon', khuc(hd, "router.get('/queue/history',").includes('demXuatHoaDon(prisma, from)'))
        ok('7i. mcp-agent: chuDe "thue" ⇒ chỉ bộ TEN_TOOL_THUE + prompt thuế + KHÔNG quyền ghi',
            ag.includes("req.body?.chuDe === 'thue'") && ag.includes('allowedTools: TEN_TOOL_THUE') && ag.includes('!thue && WRITE_ROLES.includes(role)') && ag.includes('thue ? SYSTEM_PROMPT_THUE : SYSTEM_PROMPT'))
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
