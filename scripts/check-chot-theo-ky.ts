/**
 * check:chottheoky — ba việc chạy LẠI mỗi tháng phải idempotent, và phải im khi đọc hỏng.
 *
 * Vì sao có bộ này (20/08/2026): phân bổ CCDC, khấu hao tài sản và kỳ lương đều được gọi lại
 * hàng tháng (tay hoặc cron). Chốt "kỳ này làm chưa" trước đây `.catch(() => null)` — đọc hỏng
 * thành "chưa làm" ⇒ chạy lần hai ⇒ CHI PHÍ ĐÔI nằm vĩnh viễn trong sổ, mà bảng nhìn vẫn bình
 * thường. Sửa xong thì phải có ca kiểm giữ, nếu không lần refactor sau lại `.catch` cho "an toàn".
 *
 * Chạy: npm run check:chottheoky
 */
import { allocateForPeriod } from '../src/routes/ccdc'
import { depreciateAssetForPeriod } from '../src/routes/fixedAssets'
import { recalcPeriodTotals } from '../src/routes/payroll'

let dat = 0, hong = 0
const ok = (ten: string, dung: boolean, chiTiet = '') => {
    if (dung) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }
}

/** Prisma giả: mỗi bảng khai một hàm, chưa khai thì ném để lộ ra là ca kiểm chưa phủ. */
function gia(cauHinh: Record<string, any>) {
    const bang = (ten: string) => new Proxy({}, {
        get: (_t, ph: string) => async (...args: any[]) => {
            const fn = cauHinh?.[ten]?.[ph]
            if (!fn) throw new Error(`mock thiếu ${ten}.${ph}`)
            return typeof fn === 'function' ? fn(...args) : fn
        },
    })
    return new Proxy({}, { get: (_t, ten: string) => bang(ten) })
}

const NEM = () => { throw new Error('P1001: đọc hỏng (giả lập mất kết nối)') }

async function main() {
    console.log('=== check:chottheoky — chốt idempotent của việc chạy theo kỳ ===\n')

    // ── CCDC ────────────────────────────────────────────────────────────────
    console.log('▸ Phân bổ CCDC')
    {
        let daTao = 0
        const kq = await allocateForPeriod(gia({
            cCDCAllocation: { findFirst: async () => ({ id: 'a1', amount: 100 }), create: async () => { daTao++; return {} } },
        }) as any, { id: 'c1', status: 'allocating', remainingAmount: 500, monthlyAllocation: 100 }, 8, 2026, null, null)
        ok('đã phân bổ tháng này → bỏ qua, KHÔNG tạo thêm', (kq as any).skipped === true && daTao === 0)
    }
    {
        let daTao = 0
        let nem = false
        try {
            await allocateForPeriod(gia({
                cCDCAllocation: { findFirst: NEM, create: async () => { daTao++; return {} } },
            }) as any, { id: 'c1', status: 'allocating', remainingAmount: 500, monthlyAllocation: 100 }, 8, 2026, null, null)
        } catch { nem = true }
        ok('ĐỌC HỎNG chốt kỳ → ném lỗi, KHÔNG phân bổ lần hai', nem && daTao === 0,
            `nem=${nem} daTao=${daTao}`)
    }
    {
        let daTao = 0
        const kq: any = await allocateForPeriod(gia({
            cCDCAllocation: { findFirst: async () => null, create: async (a: any) => { daTao++; return { id: 'al1', ...a.data } } },
            journalEntry: { create: async () => ({ id: 'j1' }) },
            cCDC: { update: async () => ({}) },
        }) as any, { id: 'c1', code: 'CC01', name: 'Kệ', status: 'allocating', remainingAmount: 500, monthlyAllocation: 100, allocatedAmount: 0 }, 8, 2026, null, null)
        ok('chưa phân bổ → tạo đúng 1 bút toán + 1 dòng phân bổ', daTao === 1 && kq?.ccdc?.remainingAmount === 400,
            `daTao=${daTao} conLai=${kq?.ccdc?.remainingAmount}`)
    }

    // ── Khấu hao ────────────────────────────────────────────────────────────
    console.log('\n▸ Khấu hao tài sản cố định')
    {
        let daTao = 0
        const kq: any = await depreciateAssetForPeriod(gia({
            depreciationEntry: { findFirst: async () => ({ id: 'd1' }), create: async () => { daTao++; return {} } },
        }) as any, { id: 'ts1', status: 'active' }, 8, 2026, null, null)
        ok('đã khấu hao tháng này → bỏ qua, KHÔNG ghi thêm', kq?.skipped === true && daTao === 0)
    }
    {
        let daTao = 0, nem = false
        try {
            await depreciateAssetForPeriod(gia({
                depreciationEntry: { findFirst: NEM, create: async () => { daTao++; return {} } },
            }) as any, { id: 'ts1', status: 'active' }, 8, 2026, null, null)
        } catch { nem = true }
        ok('ĐỌC HỎNG chốt kỳ → ném lỗi, KHÔNG khấu hao đôi', nem && daTao === 0, `nem=${nem} daTao=${daTao}`)
    }

    // ── Tổng kỳ lương ───────────────────────────────────────────────────────
    console.log('\n▸ Tính lại tổng kỳ lương')
    {
        let ghi: any = null
        await recalcPeriodTotals(gia({
            payrollEntry: { findMany: async () => [{ grossSalary: 10_000_000, totalInsuranceEmployee: 1_000_000, pitAmount: 200_000, netSalary: 8_800_000 }] },
            payrollPeriod: { update: async (a: any) => { ghi = a.data; return a.data } },
        }) as any, 'ky1')
        ok('cộng đúng tổng gộp/khấu trừ/thực nhận',
            ghi?.totalGross === 10_000_000 && ghi?.totalDeductions === 1_200_000 && ghi?.totalNet === 8_800_000,
            JSON.stringify(ghi))
    }
    {
        let ghi: any = null, nem = false
        try {
            await recalcPeriodTotals(gia({
                payrollEntry: { findMany: NEM },
                payrollPeriod: { update: async (a: any) => { ghi = a.data; return a.data } },
            }) as any, 'ky1')
        } catch { nem = true }
        ok('ĐỌC HỎNG bảng lương → ném lỗi, KHÔNG ghi đè tổng = 0', nem && ghi === null,
            `nem=${nem} ghi=${JSON.stringify(ghi)}`)
    }

    console.log(`\n${dat} đạt, ${hong} hỏng`)
    process.exit(hong ? 1 : 0)
}

main().catch(e => { console.error('Lỗi chạy bộ soát:', e); process.exit(2) })
