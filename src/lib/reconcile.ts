/**
 * Lõi ĐỐI CHIẾU SỔ SÁCH — hàm thuần, chỉ nhận `prisma` và khoảng ngày.
 *
 * Tách khỏi route để kiểm chứng được bằng client giả (scripts/check-reconcile.ts)
 * — logic kế toán mà không thử được thì không nên đem lên production.
 *
 * Soi CHÉO sổ với dữ liệu nghiệp vụ gốc. Bút toán kép luôn tự cân nên Bảng cân
 * đối vẫn "đẹp" ngay cả khi thiếu hẳn một mảng nghiệp vụ — chỉ có đối chiếu
 * ngược với hóa đơn / phiếu nhập / phiếu chi / phiếu trả mới lòi ra chỗ thiếu.
 */

export type Muc = 'cao' | 'vua' | 'thap'

export interface VanDe {
    code: string
    muc: Muc
    tieuDe: string
    chiTiet: string
    tien: number | null
    soLuong: number
    viDu: string[]
    ghiBuDuoc: boolean
}

export interface KetQuaSoat {
    from: string
    to: string
    soVanDe: number
    soVanDeNang: number
    ghiBuDuoc: boolean
    tongButToanKy: number
    vanDe: VanDe[]
    thieu: { ban: number; nhap: number; chi: number; tra: number }
}

const vnd = (v: number) => Math.round(v).toLocaleString('vi-VN')

/** Số dư một nhóm tài khoản theo tiền tố (Nợ − Có) */
export function soDuTheoTienTo(
    entries: Array<{ debitAccount: string; creditAccount: string; amount: number }>,
    tienTo: string,
) {
    let no = 0, co = 0
    for (const e of entries) {
        if (String(e.debitAccount || '').startsWith(tienTo)) no += e.amount
        if (String(e.creditAccount || '').startsWith(tienTo)) co += e.amount
    }
    return { no, co, du: no - co }
}

export async function soatSoSach(
    prisma: any,
    kho: { from: string; to: string; start: Date; end: Date },
): Promise<KetQuaSoat> {
    const { from, to, start, end } = kho
    const vanDe: VanDe[] = []

    /* Tải TẤT CẢ reference của bút toán trong kỳ một lần rồi so trong bộ nhớ.
     * Pool Prisma mỗi cửa hàng rất nhỏ — truy vấn theo từng phiếu là cạn kết nối
     * và kéo sập cả dashboard khi cron đang chạy. */
    const butToanKy: Array<{ reference: string | null; debitAccount: string; creditAccount: string; amount: number }> =
        await prisma.journalEntry.findMany({
            where: { date: { gte: from, lte: to } },
            select: { reference: true, debitAccount: true, creditAccount: true, amount: true },
        })
    const refCo = new Set(butToanKy.map(e => e.reference).filter(Boolean) as string[])
    // VOID-<ref> nghĩa là <ref> đã bị đảo → không tính là "đã ghi" nữa
    const daDao = new Set(Array.from(refCo).filter(r => r.startsWith('VOID-')).map(r => r.slice(5)))
    const daGhi = (ref: string) => refCo.has(ref) && !daDao.has(ref)

    // ─── 1. Hóa đơn bán chưa vào sổ ─────────────────────────────────────────
    const banChuaGhi: Array<{ receiptNumber: string; total: number }> = []
    {
        const txs = await prisma.transaction.findMany({
            where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } },
            select: { receiptNumber: true, total: true },
        })
        for (const t of txs) if (!daGhi(`SALE-${t.receiptNumber}`)) banChuaGhi.push(t)
        const tien = banChuaGhi.reduce((s, t) => s + (t.total || 0), 0)
        if (banChuaGhi.length > 0) vanDe.push({
            code: 'ban-chua-ghi', muc: 'cao',
            tieuDe: `${banChuaGhi.length} hóa đơn bán chưa vào sổ`,
            chiTiet: `Tổng ${vnd(tien)} ₫ doanh thu chưa có bút toán — Báo cáo kết quả kinh doanh đang thiếu đúng khoản này.`,
            tien, soLuong: banChuaGhi.length,
            viDu: banChuaGhi.slice(0, 5).map(t => t.receiptNumber),
            ghiBuDuoc: true,
        })
    }

    // ─── 2. Phiếu nhập chưa vào sổ ──────────────────────────────────────────
    const nhapChuaGhi: Array<{ code: string; totalCost: number }> = []
    {
        const imps = await prisma.importReceipt.findMany({
            where: { status: 'completed', createdAt: { gte: start, lte: end } },
            select: { code: true, totalCost: true },
        })
        for (const i of imps) if (!daGhi(`IMP-${i.code}`)) nhapChuaGhi.push(i)
        const tien = nhapChuaGhi.reduce((s, i) => s + (i.totalCost || 0), 0)
        if (nhapChuaGhi.length > 0) vanDe.push({
            code: 'nhap-chua-ghi', muc: 'cao',
            tieuDe: `${nhapChuaGhi.length} phiếu nhập chưa vào sổ`,
            chiTiet: `Tổng ${vnd(tien)} ₫ hàng nhập chưa ghi Nợ 156 / Có 331 — tồn kho và công nợ nhà cung cấp trên sổ đều thiếu.`,
            tien, soLuong: nhapChuaGhi.length,
            viDu: nhapChuaGhi.slice(0, 5).map(i => i.code),
            ghiBuDuoc: true,
        })
    }

    // ─── 3. Chi phí chưa vào sổ ─────────────────────────────────────────────
    const chiChuaGhi: Array<{ id: string; description: string; amount: number }> = []
    {
        const exps = await prisma.expense.findMany({
            where: { date: { gte: start, lte: end } },
            select: { id: true, description: true, amount: true, status: true },
        })
        for (const e of exps) {
            if (e.status === 'cancelled' || e.status === 'pending') continue
            if (!daGhi(`EXP-${e.id}`)) chiChuaGhi.push(e)
        }
        const tien = chiChuaGhi.reduce((s, e) => s + (e.amount || 0), 0)
        if (chiChuaGhi.length > 0) vanDe.push({
            code: 'chi-chua-ghi', muc: 'cao',
            tieuDe: `${chiChuaGhi.length} khoản chi chưa vào sổ`,
            chiTiet: `Tổng ${vnd(tien)} ₫ chi phí chưa ghi sổ — lãi trên báo cáo đang cao hơn thực tế đúng bằng khoản này.`,
            tien, soLuong: chiChuaGhi.length,
            viDu: chiChuaGhi.slice(0, 5).map(e => (e.description || e.id).slice(0, 40)),
            ghiBuDuoc: true,
        })
    }

    // ─── 4. Phiếu trả hàng chưa vào sổ ──────────────────────────────────────
    const traChuaGhi: Array<{ code: string; totalRefund: number }> = []
    {
        const rets = await prisma.returnOrder.findMany({
            where: { status: { in: ['refunded', 'exchanged'] }, createdAt: { gte: start, lte: end } },
            select: { code: true, totalRefund: true },
        })
        for (const r of rets) if (!daGhi(`RET-${r.code}`)) traChuaGhi.push(r)
        const tien = traChuaGhi.reduce((s, r) => s + (r.totalRefund || 0), 0)
        if (traChuaGhi.length > 0) vanDe.push({
            code: 'tra-chua-ghi', muc: 'cao',
            tieuDe: `${traChuaGhi.length} phiếu trả hàng chưa vào sổ`,
            chiTiet: `Tổng ${vnd(tien)} ₫ đã trả lại khách nhưng doanh thu trên sổ vẫn giữ nguyên.`,
            tien, soLuong: traChuaGhi.length,
            viDu: traChuaGhi.slice(0, 5).map(r => r.code),
            ghiBuDuoc: true,
        })
    }

    /* ─── 5. Đối chiếu SỐ DƯ ────────────────────────────────────────────────
     * Số dư phải lấy LŨY KẾ tới hết ngày `to` — so số dư của riêng một kỳ với
     * số thực tế hiện tại là so hai thứ khác nhau. */
    const luyKe: Array<{ debitAccount: string; creditAccount: string; amount: number }> =
        await prisma.journalEntry.findMany({
            where: { date: { lte: to } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        })

    // 5a. 131 vs công nợ khách
    {
        const so = soDuTheoTienTo(luyKe, '131').du
        const agg = await prisma.customer.aggregate({ _sum: { debt: true } })
        const that = Math.round(agg?._sum?.debt || 0)
        const lech = Math.round(so) - that
        if (Math.abs(lech) >= 1000) vanDe.push({
            code: 'lech-131', muc: Math.abs(lech) > Math.max(that, 1) * 0.1 ? 'cao' : 'vua',
            tieuDe: 'Phải thu khách hàng trên sổ lệch với công nợ thực tế',
            chiTiet: `Sổ TK 131 dư ${vnd(so)} ₫, tổng nợ trên hồ sơ khách là ${vnd(that)} ₫ — lệch ${vnd(Math.abs(lech))} ₫. Thường do thu nợ ghi thẳng vào sổ quỹ mà quên bút toán, hoặc sửa nợ khách bằng tay.`,
            tien: Math.abs(lech), soLuong: 0, viDu: [], ghiBuDuoc: false,
        })
    }

    // 5b. 331 vs công nợ NCC còn lại
    {
        const so = -soDuTheoTienTo(luyKe, '331').du // 331 dư Có
        const imps = await prisma.importReceipt.findMany({
            where: { status: 'completed', paymentStatus: { in: ['unpaid', 'partial'] } },
            select: { totalCost: true, paidAmount: true },
        })
        const that = Math.round(imps.reduce((s: number, i: any) => s + Math.max(0, (i.totalCost || 0) - (i.paidAmount || 0)), 0))
        const lech = Math.round(so) - that
        if (Math.abs(lech) >= 1000) vanDe.push({
            code: 'lech-331', muc: Math.abs(lech) > Math.max(that, 1) * 0.1 ? 'cao' : 'vua',
            tieuDe: 'Phải trả người bán trên sổ lệch với công nợ nhà cung cấp',
            chiTiet: `Sổ TK 331 dư Có ${vnd(so)} ₫, tổng còn nợ trên phiếu nhập là ${vnd(that)} ₫ — lệch ${vnd(Math.abs(lech))} ₫. Hay gặp khi phiếu nhập cũ chưa được ghi sổ, hoặc trả tiền NCC không qua chức năng thanh toán phiếu.`,
            tien: Math.abs(lech), soLuong: imps.length, viDu: [], ghiBuDuoc: false,
        })
    }

    // 5c. 156 vs giá trị tồn kho thực tế
    {
        const so = soDuTheoTienTo(luyKe, '156').du
        const sps = await prisma.product.findMany({ select: { stock: true, costPrice: true } })
        const that = Math.round(sps.reduce((s: number, p: any) => s + Math.max(0, p.stock || 0) * (p.costPrice || 0), 0))
        const lech = Math.round(so) - that
        if (Math.abs(lech) >= 1000) vanDe.push({
            code: 'lech-156', muc: Math.abs(lech) > Math.max(that, 1) * 0.15 ? 'cao' : 'vua',
            tieuDe: 'Giá trị hàng hóa trên sổ lệch với tồn kho thực tế',
            chiTiet: `Sổ TK 156 dư ${vnd(so)} ₫, tồn kho tính theo giá vốn hiện tại là ${vnd(that)} ₫ — lệch ${vnd(Math.abs(lech))} ₫. Nguyên nhân thường gặp: phiếu nhập chưa ghi sổ, điều chỉnh kho thủ công, hoặc giá vốn được cập nhật lại sau khi đã bán.`,
            tien: Math.abs(lech), soLuong: 0, viDu: [], ghiBuDuoc: false,
        })
    }

    // 5d. Quỹ tiền mặt âm
    {
        const q = soDuTheoTienTo(luyKe, '111').du
        if (q < -1000) vanDe.push({
            code: 'quy-am', muc: 'cao',
            tieuDe: 'Sổ quỹ tiền mặt đang ÂM',
            chiTiet: `TK 111 dư ${vnd(q)} ₫. Quỹ tiền mặt không thể âm trên thực tế — hoặc thiếu bút toán thu, hoặc có khoản chi ghi trùng.`,
            tien: Math.abs(Math.round(q)), soLuong: 0, viDu: [], ghiBuDuoc: false,
        })
    }

    // ─── 6. Bút toán không hợp lệ ───────────────────────────────────────────
    {
        const xau = butToanKy.filter(e =>
            !e.amount || e.amount <= 0 || !e.debitAccount || !e.creditAccount || e.debitAccount === e.creditAccount)
        if (xau.length > 0) vanDe.push({
            code: 'but-toan-xau', muc: 'vua',
            tieuDe: `${xau.length} bút toán không hợp lệ`,
            chiTiet: 'Có bút toán số tiền ≤ 0, thiếu tài khoản, hoặc ghi Nợ và Có cùng một tài khoản (không làm thay đổi gì nhưng làm phồng sổ nhật ký).',
            tien: null, soLuong: xau.length,
            viDu: xau.slice(0, 5).map(e => e.reference || '(không mã)'),
            ghiBuDuoc: false,
        })
    }

    // ─── 7. Bút toán ghi vào kỳ đã khóa sổ ──────────────────────────────────
    try {
        const khoa = await prisma.periodLock.findMany({ select: { year: true, month: true, isLocked: true } })
        const kyKhoa = new Set(
            (khoa || []).filter((k: any) => k.isLocked).map((k: any) => `${k.year}-${String(k.month).padStart(2, '0')}`),
        )
        if (kyKhoa.size > 0) {
            const trongKy: Array<{ reference: string | null; date: string }> = await prisma.journalEntry.findMany({
                where: { date: { gte: from, lte: to } },
                select: { reference: true, date: true },
            })
            const pham = trongKy.filter(e => kyKhoa.has(String(e.date).slice(0, 7)))
            if (pham.length > 0) vanDe.push({
                code: 'ghi-vao-ky-khoa', muc: 'cao',
                tieuDe: `${pham.length} bút toán nằm trong kỳ đã khóa sổ`,
                chiTiet: 'Kỳ đã khóa mà vẫn có bút toán mang ngày trong kỳ đó — số đã nộp cho cơ quan thuế và số trên sổ sẽ không còn khớp nhau.',
                tien: null, soLuong: pham.length,
                viDu: pham.slice(0, 5).map(e => `${e.reference || '(không mã)'} · ${e.date}`),
                ghiBuDuoc: false,
            })
        }
    } catch { /* chưa có bảng PeriodLock — bỏ qua */ }

    const thuTu: Record<Muc, number> = { cao: 0, vua: 1, thap: 2 }
    vanDe.sort((a, b) => thuTu[a.muc] - thuTu[b.muc] || (b.tien ?? 0) - (a.tien ?? 0))

    return {
        from, to,
        soVanDe: vanDe.length,
        soVanDeNang: vanDe.filter(v => v.muc === 'cao').length,
        ghiBuDuoc: vanDe.some(v => v.ghiBuDuoc),
        tongButToanKy: butToanKy.length,
        vanDe,
        thieu: {
            ban: banChuaGhi.length, nhap: nhapChuaGhi.length,
            chi: chiChuaGhi.length, tra: traChuaGhi.length,
        },
    }
}
