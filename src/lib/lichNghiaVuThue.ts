// ─────────────────────────────────────────────────────────────────────────────
//  LỊCH NGHĨA VỤ THUẾ + SỐ DƯ THUẾ PHẢI NỘP — tách khỏi routes/tax.ts (22/10/2026)
//
//  Trang Nghĩa Vụ Thuế (GET /api/tax/deadlines, /reports/tax-obligations) và công cụ AI
//  tax_deadlines (routes/mcpTaxTools) dùng CHUNG: AI không được nói số khác màn hình.
//  docLichNghiaVu GIỮ NGUYÊN hành vi route cũ: gieo mốc còn thiếu theo hồ sơ cửa hàng và
//  chuyển mốc quá hạn sang 'overdue' (đều lặp lại được, mở trang cũng làm y vậy).
// ─────────────────────────────────────────────────────────────────────────────

import { ganTienChoMoc, type MocNghiaVu } from './taxCalendar'
import { suyHoSoThue, gieoLichNghiaVu } from './taxCalendarStore'

/* Bảng CHƯA MIGRATE (P2021) thì coi như rỗng — cửa hàng chưa bật tính năng đó, đúng là không có
 * số liệu. Lỗi ĐỌC khác (mất kết nối, hết pool…) phải nổi lên, không nuốt thành 0 (20/08/2026). */
const rongNeuChuaCoBang = (e: any): any[] => {
    const ma = String(e?.code || '')
    if (ma === 'P2021' || ma === 'P2022' || /does not exist|relation .* does not exist/i.test(String(e?.message || ''))) return []
    throw e
}

/** Tham số y như query của GET /api/tax/deadlines. Không có `year` thì KHÔNG lọc theo năm (giữ hành vi cũ). */
export interface ThamSoLich {
    year?: unknown
    kyKeKhai?: unknown
    taxType?: unknown
    status?: unknown
}

/** Danh sách mốc nghĩa vụ đã gắn số tiền, căn cứ, số ngày tới hạn — đúng dữ liệu trang Nghĩa Vụ Thuế hiện. */
export async function docLichNghiaVu(prisma: any, q: ThamSoLich) {
    const year = Number(q.year) || new Date().getFullYear()

    /* Lịch nghĩa vụ phải theo ĐÚNG hồ sơ của cửa hàng.
     *
     * Bản trước sinh cả tờ khai GTGT tháng LẪN quý cho mọi cửa hàng: một nơi
     * chỉ khai một kiểu, nên nửa số mốc là việc không bao giờ làm — rồi tới
     * hạn chúng tự chuyển sang "quá hạn" và biến trang nghĩa vụ thuế thành
     * một bức tường báo động giả. Hộ kinh doanh còn bị hiện cả quyết toán
     * TNDN và báo cáo tài chính, hai thứ họ không phải nộp. */
    const hoSo = await suyHoSoThue(prisma, year, String(q.kyKeKhai || ''))
    const loaiHinh = hoSo.loaiHinh
    const seeds = await gieoLichNghiaVu(prisma, year, hoSo)


    // Auto-mark overdue: pending items whose dueDate < today
    const today = new Date().toISOString().slice(0, 10)
    await prisma.taxDeadline.updateMany({
        where: { status: 'pending', dueDate: { lt: today } },
        data: { status: 'overdue' },
    })

    const where: any = {}
    if (q.year) {
        const y = Number(q.year)
        where.OR = [
            { period: { contains: `/${y}` } },
            { period: { contains: `-${y}` } },
        ]
    }
    if (q.taxType) where.taxType = String(q.taxType)
    if (q.status) where.status = String(q.status)

    const data = await prisma.taxDeadline.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }],
    })
    // Bổ sung field FE cần: type/label/daysUntilDue/estimatedAmount + status
    // upcoming|due_soon (giữ nguyên field gốc để không vỡ chỗ khác)
    const seedTheoKhoa = new Map(seeds.map((x: MocNghiaVu) => [`${x.taxType}|${x.period}`, x]))

    /* Số tiền phải nộp của từng mốc. Bảng TaxDeadline không có cột tiền nên
     * trang nghĩa vụ thuế đang hiện 0đ cho tất cả — một danh sách hạn nộp
     * không kèm số tiền chỉ trả lời được "khi nào", còn câu người ta cần là
     * "phải chuẩn bị bao nhiêu". Ba truy vấn gộp một lần rồi tra tại chỗ. */
    const tienTheoKhoa = new Map<string, any>()
    try {
        const toKhaiNam: any[] = await prisma.taxDeclaration.findMany({
            where: { year },
            select: { period: true, formType: true, ct38: true, ct40a: true, cnkdTotalTax: true },
        }).catch(rongNeuChuaCoBang)
        const toKhaiTheoKy = new Map<string, number>()
        for (const t of toKhaiNam) {
            if (String(t.formType || '').includes('_BS')) continue   // bản bổ sung không phải số gốc
            /* So thue phai nop nam o [38]; [40a] la de nghi hoan va he thong
             * de luon bang 0 khi tu tinh to khai. Doc [40a] la moi moc han
             * nop deu hien 0 dong. */
            toKhaiTheoKy.set(String(t.period),
                Number(t.formType === '01_CNKD'
                    ? t.cnkdTotalTax
                    : (t.ct38 || t.ct40a)) || 0)
        }

        const kyLuong: any[] = await prisma.payrollPeriod.findMany({
            where: { year },
            select: { id: true, month: true },
        }).catch(rongNeuChuaCoBang)
        const tncnTheoKy = new Map<string, number>()
        if (kyLuong.length) {
            const dong: any[] = await prisma.payrollEntry.findMany({
                where: { periodId: { in: kyLuong.map((k: any) => k.id) } },
                select: { periodId: true, pitAmount: true },
            }).catch(rongNeuChuaCoBang)
            const thangCua = new Map(kyLuong.map((k: any) => [k.id, k.month]))
            for (const e of dong) {
                const m = thangCua.get(e.periodId)
                if (!m) continue
                const kThang = `${year}-${String(m).padStart(2, '0')}`
                const kQuy = `${year}-Q${Math.ceil(m / 3)}`
                tncnTheoKy.set(kThang, (tncnTheoKy.get(kThang) || 0) + (e.pitAmount || 0))
                tncnTheoKy.set(kQuy, (tncnTheoKy.get(kQuy) || 0) + (e.pitAmount || 0))
            }
        }

        const btNam: any[] = await prisma.journalEntry.findMany({
            where: { date: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
            select: { date: true, debitAccount: true, creditAccount: true, amount: true },
        }).catch(rongNeuChuaCoBang)
        const laiTheoQuy = new Map<number, number>()
        const laDoanhThu = (tk: string) => /^(511|515|711)/.test(tk)
        const laChiPhi = (tk: string) => /^(632|635|641|642|811)/.test(tk)
        for (const e of btNam) {
            const q = Math.ceil(Number(String(e.date).slice(5, 7)) / 3)
            if (!q) continue
            let v = 0
            if (laDoanhThu(String(e.creditAccount || ''))) v += e.amount
            if (laDoanhThu(String(e.debitAccount || ''))) v -= e.amount
            if (laChiPhi(String(e.debitAccount || ''))) v -= e.amount
            if (laChiPhi(String(e.creditAccount || ''))) v += e.amount
            laiTheoQuy.set(q, (laiTheoQuy.get(q) || 0) + v)
        }

        const dtNamTruoc: any[] = await prisma.journalEntry.findMany({
            where: { date: { gte: `${year - 1}-01-01`, lte: `${year - 1}-12-31` } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        }).catch(rongNeuChuaCoBang)
        const doanhThuNamTruoc = dtNamTruoc.length
            ? dtNamTruoc.reduce((s: number, e: any) =>
                s + (String(e.creditAccount || '').startsWith('511') ? e.amount : 0)
                - (String(e.debitAccount || '').startsWith('511') ? e.amount : 0), 0)
            : null

        for (const m of seeds) {
            tienTheoKhoa.set(`${m.taxType}|${m.period}`, ganTienChoMoc(m, {
                loaiHinh, doanhThuNamTruoc, toKhaiTheoKy, tncnTheoKy, laiTheoQuy,
            }))
        }
    } catch (e: any) {
        console.warn('[Deadlines] không ước tính được số tiền:', e?.message || e)
    }
    const nowMs = Date.now()
    const enriched = data.map((d: any) => {
        const daysUntilDue = Math.ceil((new Date(d.dueDate).getTime() - nowMs) / 86400000)
        const feStatus = d.status === 'pending'
            ? (daysUntilDue <= 7 ? 'due_soon' : 'upcoming')
            : d.status
        /* Bảng TaxDeadline không có cột căn cứ pháp lý và loại việc, mà hai
         * thứ đó lại quan trọng: rất nhiều người nhầm "tạm nộp thuế TNDN
         * quý" là phải nộp tờ khai, rồi đi tìm mẫu tờ khai không tồn tại.
         * Gắn lại từ lịch chuẩn vừa dựng, khớp theo loại + kỳ. */
        const chuan = seedTheoKhoa.get(`${d.taxType}|${d.period}`)
        const tien = tienTheoKhoa.get(`${d.taxType}|${d.period}`)
        return {
            ...d,
            type: d.taxType,
            label: d.description || d.taxType,
            daysUntilDue,
            /* null khi không suy ra được — KHÔNG quy về 0, vì "0đ" nghĩa là
             * không phải nộp gì, còn "chưa biết" là phải đi tra. Hai điều
             * hoàn toàn khác nhau với người đang chuẩn bị tiền nộp thuế. */
            /* `TaxDeadline` không có cột `estimatedAmount` — toán hạng đầu luôn undefined,
             * đã bỏ. Nguồn thật là `tien?.soTien`. (21/08/2026) */
            estimatedAmount: tien?.soTien ?? null,
            nguonSoTien: tien ? (tien.tuToKhai ? 'to-khai' : 'uoc-tinh') : null,
            dienGiaiSoTien: tien?.dienGiai ?? null,
            status: feStatus,
            rawStatus: d.status,
            canCu: chuan?.canCu ?? null,
            loaiViec: chuan?.loaiViec ?? null,
        }
    })
    return enriched
}

/** Số dư CUỐI NĂM các TK thuế phải nộp: 3331 GTGT, 3334 TNDN, 3335 TNCN (Có − Nợ) — như GET /reports/tax-obligations. */
export async function soDuThuePhaiNop(prisma: any, year: number) {
    const entries: { debitAccount: string | null; creditAccount: string | null; amount: number }[] = await prisma.journalEntry.findMany({
        where: { date: { lte: `${year}-12-31` } },
        select: { debitAccount: true, creditAccount: true, amount: true },
    })
    const netCr = (prefixes: string[]) => {
        let dr = 0, cr = 0
        for (const e of entries) {
            if (prefixes.some(p => e.debitAccount?.startsWith(p))) dr += e.amount || 0
            if (prefixes.some(p => e.creditAccount?.startsWith(p))) cr += e.amount || 0
        }
        return cr - dr
    }
    const vatPayable = netCr(['3331'])
    const citPayable = netCr(['3334'])
    const pitPayable = netCr(['3335'])
    return { vatPayable, citPayable, pitPayable, total: vatPayable + citPayable + pitPayable }
}
