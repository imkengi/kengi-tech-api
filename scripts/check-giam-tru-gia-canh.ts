/**
 * Kiểm GIẢM TRỪ GIA CẢNH THUẾ TNCN theo NĂM KỲ TÍNH THUẾ — npx tsx scripts/check-giam-tru-gia-canh.ts [đường FE]
 *
 * Phát hiện 22/10/2026, sửa 14/11/2026: mức 11tr / 4,4tr (NQ 954/2020) viết cứng ở 6 chỗ BE + 4 chỗ FE nên
 * bảng lương, quyết toán, soát thuế NĂM 2026 vẫn tính theo mức cũ. Từ kỳ tính thuế 2026 mức đúng là
 * 15,5tr / 6,2tr (NQ 110/2025/UBTVQH15; khoản 1 Điều 10 Luật Thuế TNCN 109/2025/QH15). Bộ này canh:
 *   1. bảng mức: 2025 ra mức cũ, 2026 ra mức mới, năm ngoài bảng thì NÉM (không lặng lẽ lấy mức năm khác)
 *   2. năm kỳ tính thuế của lương = năm TRẢ (khoản 3 Điều 8 Luật 109/2025): lương T12/2025 trả T1/2026 ⇒ mức 2026
 *   3. bảng lương tháng (computeEntry), quyết toán năm, công cụ AI tax_pit dùng ĐÚNG mức của năm
 *   4. không chỗ nào trong src/ viết cứng lại các con số này (đánh dấu `giamtru-ok` nếu là số khác nghĩa)
 *   5. bản sao ở FE (open-retail/src/lib/giamTruGiaCanh.ts) cùng bảng với BE, FE không viết cứng số
 */
import fs from 'fs'
import path from 'path'
import {
    BANG_MUC_GIAM_TRU, mucGiamTruGiaCanh, namKyTinhThueLuong, namTheoGioVN, giamTruThang, giamTruThangToiDa,
} from '../src/lib/giamTruGiaCanh'
import { aggregatePitByEmployee, docQuyetToanTncn, giamTruBanDaLuuLech, calculatePitProgressive } from '../src/lib/quyetToanTncn'
import { computeEntry } from '../src/routes/payroll'
import { TAX_TOOLS } from '../src/routes/mcpTaxTools'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)?.slice(0, 500)}` : ''}`) }
}
const nem = (fn: () => any) => { try { fn(); return false } catch (e) { return e instanceof RangeError } }

const GOC = path.resolve(__dirname, '..')
const LIB_BE = path.join(GOC, 'src', 'lib', 'giamTruGiaCanh.ts')
/** Số giảm trừ viết cứng: 11_000_000 · 4_400_000 · 15_500_000 · 6_200_000 (có/không gạch dưới) hoặc dạng 11e6. */
const SO_CUNG = /(?<![\w.])(?:11_?000_?000|4_?400_?000|15_?500_?000|6_?200_?000|11e6|4\.4e6|15\.5e6|6\.2e6)(?![\w.])/

function quetThuMuc(goc: string, duoi: RegExp, boQua: (p: string) => boolean): string[] {
    const ra: string[] = []
    const di = (thuMuc: string) => {
        for (const d of fs.readdirSync(thuMuc, { withFileTypes: true })) {
            const p = path.join(thuMuc, d.name)
            if (boQua(p)) continue
            if (d.isDirectory()) di(p)
            else if (duoi.test(d.name)) ra.push(p)
        }
    }
    di(goc)
    return ra
}

/** Dòng chứa số giảm trừ viết cứng (bỏ qua file nguồn sự thật + dòng đánh dấu `giamtru-ok`). */
function timSoCung(tep: string[], tepNguon: string): string[] {
    const ra: string[] = []
    for (const f of tep) {
        if (path.resolve(f) === path.resolve(tepNguon)) continue
        const dong = fs.readFileSync(f, 'utf8').split('\n')
        dong.forEach((d, i) => { if (SO_CUNG.test(d) && !/giamtru-ok/.test(d)) ra.push(`${path.relative(GOC, f)}:${i + 1}: ${d.trim().slice(0, 120)}`) })
    }
    return ra
}

/** Prisma giả tối thiểu cho quyết toán: chưa khai thì NÉM để lộ ca chưa phủ. */
function giaQuyetToan(records: any[], saved: any = null) {
    return {
        taxDeclaration: { findUnique: async () => saved },
        payrollRecord: {
            findMany: async ({ where }: any = {}) => records.filter(r => where?.year === undefined || r.year === where.year),
        },
    }
}
const banLuong = (ten: string, nam: number, thang: number, gross: number, pit: number, dependents = 0) => ({
    employeeId: ten, employeeName: ten, employeeCode: `NV-${ten}`, department: null, year: nam, month: thang,
    grossSalary: gross, actualGross: gross, bonus: 0, bhxh_emp: 0, bhyt_emp: 0, bhtn_emp: 0, dependents, pit,
})

async function main() {
    console.log('\n═══ GIẢM TRỪ GIA CẢNH THEO NĂM KỲ TÍNH THUẾ ═══\n')

    console.log('▸ 1. Bảng mức')
    {
        const m25 = mucGiamTruGiaCanh(2025), m26 = mucGiamTruGiaCanh(2026)
        ok('1a. kỳ 2025 = mức CŨ 11.000.000 / 4.400.000 (NQ 954/2020)',
            m25.banThanThang === 11_000_000 && m25.nguoiPhuThuocThang === 4_400_000 && /954\/2020/.test(m25.canCu), m25)
        ok('1b. kỳ 2026 = mức MỚI 15.500.000 / 6.200.000 (NQ 110/2025, Luật 109/2025)',
            m26.banThanThang === 15_500_000 && m26.nguoiPhuThuocThang === 6_200_000 && /110\/2025/.test(m26.canCu) && /109\/2025/.test(m26.canCu), m26)
        ok('1c. 15.500.000 × 12 = 186.000.000/năm (khớp khoản 1 Điều 10 Luật 109/2025)', m26.banThanThang * 12 === 186_000_000)
        ok('1d. kỳ 2020 vẫn mức NQ 954; kỳ 2027 giữ mức mới tới khi có dòng mới',
            mucGiamTruGiaCanh(2020).banThanThang === 11_000_000 && mucGiamTruGiaCanh(2027).banThanThang === 15_500_000)
        ok('1e. năm ngoài bảng (2019) hoặc không phải năm (NaN, 2025.5, "abc") ⇒ NÉM, không lặng lẽ trả mức khác',
            nem(() => mucGiamTruGiaCanh(2019)) && nem(() => mucGiamTruGiaCanh(NaN)) && nem(() => mucGiamTruGiaCanh(2025.5)) && nem(() => mucGiamTruGiaCanh('abc' as any)))
        ok('1f. bảng xếp tuNam tăng dần, không trùng năm',
            BANG_MUC_GIAM_TRU.every((m, i) => i === 0 || m.tuNam > BANG_MUC_GIAM_TRU[i - 1].tuNam), BANG_MUC_GIAM_TRU.map(m => m.tuNam))
        const g = giamTruThang(2026, 2)
        ok('1g. giảm trừ một tháng 2026 + 2 người phụ thuộc = 15,5tr + 12,4tr = 27,9tr',
            g.banThan === 15_500_000 && g.nguoiPhuThuoc === 12_400_000 && g.tong === 27_900_000, g)
        ok('1h. số người phụ thuộc âm/rỗng/lẻ ⇒ 0 / làm tròn xuống, không trừ âm',
            giamTruThang(2026, -1).nguoiPhuThuoc === 0 && giamTruThang(2026, NaN).nguoiPhuThuoc === 0 && giamTruThang(2025, 1.7).nguoiPhuThuoc === 4_400_000)
    }

    console.log('\n▸ 2. Năm kỳ tính thuế của tiền lương = năm TRẢ (khoản 3 Điều 8 Luật 109/2025/QH15)')
    {
        ok('2a. kỳ lương T11/2025, không rõ ngày trả ⇒ năm của kỳ lương 2025 ⇒ mức cũ',
            namKyTinhThueLuong({ nam: 2025 }) === 2025 && giamTruThang(namKyTinhThueLuong({ nam: 2025 }), 0).banThan === 11_000_000)
        const namT12 = namKyTinhThueLuong({ nam: 2025, ngayTra: '2026-01-09' })
        ok('2b. lương T12/2025 TRẢ 09/01/2026 ⇒ kỳ 2026 ⇒ mức MỚI 15,5tr / 6,2tr (Thuế Đồng Nai, câu hỏi 261225-17 Cổng TTĐT BTC)',
            namT12 === 2026 && giamTruThang(namT12, 1).tong === 21_700_000, namT12)
        ok('2c. lương T12/2025 trả 31/12/2025 ⇒ vẫn kỳ 2025 ⇒ mức cũ',
            namKyTinhThueLuong({ nam: 2025, ngayTra: '2025-12-31' }) === 2025)
        ok('2d. mốc giờ theo VIỆT NAM: 31/12/2025 20:00 UTC = 01/01/2026 03:00 VN ⇒ 2026; 16:59:59 UTC = 23:59:59 VN ⇒ 2025',
            namKyTinhThueLuong({ nam: 2025, ngayTra: '2025-12-31T20:00:00Z' }) === 2026
            && namKyTinhThueLuong({ nam: 2025, ngayTra: new Date('2025-12-31T16:59:59Z') }) === 2025)
        ok('2e. ngày trả rỗng/null ⇒ năm kỳ lương; ngày trả hỏng ("abc") ⇒ NÉM (đoán sai năm là sai mức cả kỳ)',
            namKyTinhThueLuong({ nam: 2026, ngayTra: '' }) === 2026 && namKyTinhThueLuong({ nam: 2026, ngayTra: null }) === 2026
            && nem(() => namKyTinhThueLuong({ nam: 2025, ngayTra: 'abc' })))
        ok('2f. namTheoGioVN đọc hỏng ⇒ null (không ra năm 1970)', namTheoGioVN('khong-phai-ngay') === null && namTheoGioVN(undefined) === null)
        ok('2g. phép SOÁT kỳ T12/2025 (chưa chắc ngày trả) lấy mức CAO hơn = 15,5tr; T11/2025 = 11tr; T12/2026 = 15,5tr',
            giamTruThangToiDa({ nam: 2025, thang: 12 }, 0).banThan === 15_500_000
            && giamTruThangToiDa({ nam: 2025, thang: 11 }, 0).banThan === 11_000_000
            && giamTruThangToiDa({ nam: 2026, thang: 12 }, 0).banThan === 15_500_000)
    }

    console.log('\n▸ 3. Bảng lương tháng (routes/payroll computeEntry — kỳ lương BE)')
    {
        // Lương cơ bản 20tr ⇒ BH người LĐ 10,5% = 2,1tr ⇒ thu nhập chịu thuế 17,9tr
        const nv = { id: 'nv1', code: 'NV1', name: 'An', baseSalary: 20_000_000, dependents: 0 }
        const k25 = computeEntry(nv, { namKyTinhThue: 2025 })
        ok('3a. kỳ 2025: giảm trừ 11tr ⇒ tính thuế 6,9tr ⇒ TNCN 440.000 (5tr×5% + 1,9tr×10%)',
            k25.personalDeduction === 11_000_000 && k25.assessableIncome === 6_900_000 && k25.pitAmount === 440_000, k25)
        const k26 = computeEntry(nv, { namKyTinhThue: 2026 })
        ok('3b. kỳ 2026: giảm trừ 15,5tr ⇒ tính thuế 2,4tr ⇒ TNCN 120.000',
            k26.personalDeduction === 15_500_000 && k26.assessableIncome === 2_400_000 && k26.pitAmount === 120_000, k26)
        const kT12 = computeEntry(nv, { namKyTinhThue: namKyTinhThueLuong({ nam: 2025, ngayTra: '2026-01-09' }) })
        ok('3c. lương T12/2025 trả T1/2026 ⇒ tính như kỳ 2026 (TNCN 120.000, không phải 440.000)',
            kT12.personalDeduction === 15_500_000 && kT12.pitAmount === 120_000, kT12)
        const nv1 = { ...nv, dependents: 1 }
        const p25 = computeEntry(nv1, { namKyTinhThue: 2025 }), p26 = computeEntry(nv1, { namKyTinhThue: 2026 })
        ok('3d. 1 người phụ thuộc: 2025 trừ 4,4tr ⇒ TNCN 125.000; 2026 trừ 6,2tr ⇒ dưới ngưỡng, TNCN 0',
            p25.dependentDeduction === 4_400_000 && p25.pitAmount === 125_000 && p26.dependentDeduction === 6_200_000 && p26.pitAmount === 0, { p25: p25.pitAmount, p26: p26.pitAmount })
        ok('3e. lương thực nhận tăng đúng bằng phần thuế giảm (2026 so 2025: +320.000)', k26.netSalary - k25.netSalary === 320_000, k26.netSalary - k25.netSalary)
    }

    console.log('\n▸ 4. Quyết toán TNCN năm (lib/quyetToanTncn)')
    {
        // 12 tháng × 20tr, không BH, không người phụ thuộc
        const nam = (y: number) => Array.from({ length: 12 }, (_, i) => banLuong('Binh', y, i + 1, 20_000_000, 0))
        const [q25] = aggregatePitByEmployee(nam(2025), 2025)
        ok('4a. quyết toán 2025: giảm trừ bản thân 12 × 11tr = 132tr ⇒ tính thuế 108tr ⇒ thuế 7.800.000',
            q25.selfDeduction === 132_000_000 && q25.taxableIncome === 108_000_000 && q25.taxAmount === 7_800_000, q25)
        const [q26] = aggregatePitByEmployee(nam(2026), 2026)
        ok('4b. quyết toán 2026: 12 × 15,5tr = 186tr ⇒ tính thuế 54tr ⇒ thuế 2.700.000',
            q26.selfDeduction === 186_000_000 && q26.taxableIncome === 54_000_000 && q26.taxAmount === 2_700_000, q26)
        ok('4c. biểu luỹ tiến năm không đổi (đổi biểu 5 bậc chờ chủ shop duyệt): 108tr ⇒ 7,8tr', calculatePitProgressive(108_000_000) === 7_800_000)
        const tinh: any = await docQuyetToanTncn(giaQuyetToan(nam(2026)), 2026)
        ok('4d. docQuyetToanTncn 2026 (tự tính) trả kèm mức đang áp: 15,5tr / 6,2tr',
            tinh.source === 'calculated' && tinh.giamTru?.banThanMoiThang === 15_500_000 && tinh.giamTru?.moiNguoiPhuThuocMoiThang === 6_200_000 && tinh.summary?.totalTax === 2_700_000, tinh.giamTru)
        const luuCu = (y: number, moiThang: number) => ({
            id: 'd1', status: 'draft', notes: JSON.stringify({
                __pit: true, employees: [{ employeeId: 'x', employeeCode: null, name: 'Chi', department: null, monthsWorked: 12, totalIncome: 240_000_000, totalInsurance: 0, selfDeduction: moiThang * 12, dependentDeduction: 0, deductions: moiThang * 12, taxableIncome: 0, taxAmount: 0, pitWithheld: 0, balanceDue: 0 }],
            }),
        })
        const luu26: any = await docQuyetToanTncn(giaQuyetToan([], luuCu(2026, 11_000_000)), 2026)
        ok('4e. bản ĐÃ LƯU năm 2026 còn mức 11tr ⇒ báo lệch (KHÔNG tính lại, không ghi đè)',
            luu26.source === 'saved' && luu26.giamTruLech?.banThanMoiThangDaLuu === 11_000_000 && luu26.giamTruLech?.banThanMoiThangDung === 15_500_000 && luu26.employees?.[0]?.selfDeduction === 132_000_000, luu26.giamTruLech)
        const luu25: any = await docQuyetToanTncn(giaQuyetToan([], luuCu(2025, 11_000_000)), 2025)
        ok('4f. bản đã lưu 2025 với 11tr là ĐÚNG ⇒ im', luu25.source === 'saved' && luu25.giamTruLech === null, luu25.giamTruLech)
        ok('4g. bản đã lưu số lạ (giảm trừ 0, 0 tháng) ⇒ im — không đủ bằng chứng',
            giamTruBanDaLuuLech([{ monthsWorked: 12, selfDeduction: 0 } as any, { monthsWorked: 0, selfDeduction: 5 } as any], 2026) === null)
    }

    console.log('\n▸ 5. Công cụ AI tax_pit')
    {
        const tool = TAX_TOOLS.find(t => t.name === 'tax_pit')!
        const records = Array.from({ length: 12 }, (_, i) => banLuong('An', 2026, i + 1, 20_000_000, 120_000))
        const ctx = (p: any) => ({ prisma: p, storeId: 's', storeCode: 'S', userId: 'u', role: 'admin' } as any)
        const kq: any = await tool.run({ year: 2026 }, ctx(giaQuyetToan(records)))
        ok('5a. năm 2026 tính theo mức mới ⇒ không còn "cảnh báo mức cũ", nêu mức đang áp 15,5tr',
            !('canhBaoMucGiamTru' in kq) && kq.giamTruTheoLuat?.banThanMoiThang === 15_500_000 && kq.tongHop?.thuePhaiNop === 2_700_000, { canhBao: kq.canhBaoMucGiamTru, gt: kq.giamTruTheoLuat, thue: kq.tongHop?.thuePhaiNop })
        const saved = { id: 'd1', status: 'submitted', notes: JSON.stringify({ __pit: true, employees: [{ employeeId: 'x', employeeCode: null, name: 'Chi', department: null, monthsWorked: 12, totalIncome: 240_000_000, totalInsurance: 0, selfDeduction: 132_000_000, dependentDeduction: 0, deductions: 132_000_000, taxableIncome: 108_000_000, taxAmount: 7_800_000, pitWithheld: 0, balanceDue: 7_800_000 }] }) }
        const kqLuu: any = await tool.run({ year: 2026 }, ctx(giaQuyetToan([], saved)))
        ok('5b. bản đã lưu năm 2026 còn 11tr ⇒ AI bị buộc nói rõ (nêu 11.000.000 và 15.500.000, bảo lập lại)',
            typeof kqLuu.canhBaoMucGiamTru === 'string' && /11\.000\.000/.test(kqLuu.canhBaoMucGiamTru) && /15\.500\.000/.test(kqLuu.canhBaoMucGiamTru) && /lập lại/.test(kqLuu.canhBaoMucGiamTru), kqLuu.canhBaoMucGiamTru)
        const kq19: any = await tool.run({ year: 2019 }, ctx(giaQuyetToan([])))
        ok('5c. năm ngoài bảng mức (2019) ⇒ ghi chú rõ, không văng lỗi', typeof kq19.ghiChu === 'string' && /2019/.test(kq19.ghiChu), kq19)
    }

    console.log('\n▸ 6. Mọi chỗ dùng chung một nguồn — soát mã nguồn')
    {
        const doc = (p: string) => fs.readFileSync(path.join(GOC, 'src', p), 'utf8')
        const tep = quetThuMuc(path.join(GOC, 'src'), /\.ts$/, p => /[\\/]generated([\\/]|$)/.test(p))
        const cung = timSoCung(tep, LIB_BE)
        ok(`6a. không file nào trong src/ viết cứng 11/4,4/15,5/6,2 triệu (ngoài lib/giamTruGiaCanh) — quét ${tep.length} file`, tep.length > 100 && cung.length === 0, cung)
        const luong = doc('routes/payroll.ts'), thue = doc('routes/tax.ts'), soat = doc('lib/taxAudit.ts'), dien = doc('lib/auditDrill.ts'), qt = doc('lib/quyetToanTncn.ts')
        ok('6b. payroll.ts: computeEntry lấy giamTruThang(opts.namKyTinhThue) + route tính lương dùng namKyTinhThueLuong(kỳ, ngayTraLuong)',
            /giamTruThang\(opts\.namKyTinhThue/.test(luong) && /namKyTinhThueLuong\(\{ nam: Number\(period\.year\), ngayTra: b\.ngayTraLuong \}\)/.test(luong))
        ok('6c. tax.ts: /payroll-accounting trừ giamTruThang(year, …) + /pit-settlement/calculate gọi tinhQuyetToanTuBangLuong',
            /giamTruThang\(year, r\.dependents\)/.test(thue) && /tinhQuyetToanTuBangLuong\(prisma, year\)/.test(thue))
        ok('6d. quyết toán: aggregatePitByEmployee nhận năm, docQuyetToanTncn + /calculate cùng một hàm tính',
            /aggregatePitByEmployee\(records, year\)/.test(qt) && /await tinhQuyetToanTuBangLuong\(prisma, year\)/.test(qt))
        ok('6e. soát thuế (taxAudit) và mô phỏng thanh tra (auditDrill) lấy ngưỡng qua giamTruThangToiDa',
            /giamTruThangToiDa\(/.test(soat) && /giamTruThangToiDa\(/.test(dien))
    }

    console.log('\n▸ 7. Bản sao FE (open-retail/src/lib/giamTruGiaCanh.ts)')
    {
        const fe = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(GOC, '..', 'open-retail')
        const libFe = path.join(fe, 'src', 'lib', 'giamTruGiaCanh.ts')
        if (!fs.existsSync(libFe)) {
            /* Cây FE chưa có bản sao (worktree tìm sai chỗ, hoặc cây FE chung cũ hơn origin) ⇒ KHÔNG kết luận,
             * nói rõ là bỏ qua — đừng đếm thành "đạt". Truyền đường FE: npx tsx scripts/check-giam-tru-gia-canh.ts <FE> */
            console.log(`  ⚠ bỏ qua phần FE — không thấy ${libFe}`)
        } else {
            const nguon = fs.readFileSync(libFe, 'utf8')
            const dongFe = [...nguon.matchAll(/tuNam:\s*(\d{4}),\s*banThanThang:\s*([\d_]+),\s*nguoiPhuThuocThang:\s*([\d_]+)/g)]
                .map(m => [Number(m[1]), Number(m[2].replace(/_/g, '')), Number(m[3].replace(/_/g, ''))])
            const dongBe = BANG_MUC_GIAM_TRU.map(m => [m.tuNam, m.banThanThang, m.nguoiPhuThuocThang])
            ok('7a. bảng mức FE trùng từng dòng với BE', JSON.stringify(dongFe) === JSON.stringify(dongBe), { fe: dongFe, be: dongBe })
            const tepFe = quetThuMuc(path.join(fe, 'src'), /\.(ts|tsx)$/, p => /[\\/](node_modules|\.next|out)([\\/]|$)/.test(p))
            const cungFe = timSoCung(tepFe, libFe)
            ok(`7b. FE không viết cứng số giảm trừ ngoài lib/giamTruGiaCanh — quét ${tepFe.length} file`, tepFe.length > 100 && cungFe.length === 0, cungFe)
        }
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
