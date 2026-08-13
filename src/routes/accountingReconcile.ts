// ─────────────────────────────────────────────────────────────────────────────
//  ĐỐI CHIẾU SỔ SÁCH — mounted at /api/accounting
//
//    GET  /api/accounting/reconcile?from=&to=   soát sổ, trả danh sách vấn đề
//    POST /api/accounting/reconcile/fix         ghi bù bút toán còn thiếu
//
//  Vì sao cần: bút toán được sinh tự động ở nhiều đường (POS, nhập hàng, chi
//  phí, trả hàng, ghi bù thủ công). Chỉ cần một lần lỗi mạng, một phiếu tạo
//  trước ngày tính năng ra đời, hay một nghiệp vụ chưa được nối vào bút toán là
//  sổ đã lệch — mà Bảng cân đối vẫn "đẹp" vì bút toán kép luôn tự cân. Endpoint
//  này soi CHÉO sổ với dữ liệu nghiệp vụ gốc để chỉ ra chỗ lệch trước khi kế
//  toán mang số đi quyết toán.
//
//  Nguyên tắc: KHÔNG tự sửa gì khi soát (GET chỉ đọc). Sửa là hành động riêng,
//  do người dùng bấm, và chỉ ghi thêm bút toán còn thiếu — không xóa, không sửa
//  bút toán cũ.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'
import { createJournalEntriesForTransaction } from '../lib/autoJournal'
import { postImportReceiptJournal, postExpenseJournal, postReturnJournal } from '../lib/autoJournalPurchase'

const router = Router()

type Muc = 'cao' | 'vua' | 'thap'

interface VanDe {
    /** Mã ổn định để giao diện biết nút "ghi bù" nào áp dụng được */
    code: string
    muc: Muc
    tieuDe: string
    /** Câu giải thích kèm con số làm căn cứ */
    chiTiet: string
    /** Số tiền đang lệch/đang treo */
    tien: number | null
    /** Số bản ghi liên quan */
    soLuong: number
    /** Vài mã ví dụ để người dùng mở ra đối chiếu */
    viDu: string[]
    /** true nếu bấm "Ghi bù" xử lý được ngay */
    ghiBuDuoc: boolean
}

const ngay = (d: Date) => d.toISOString().slice(0, 10)

/** Khoảng ngày: ?from&to (YYYY-MM-DD), mặc định từ đầu năm tới hôm nay */
function khoangNgay(q: any) {
    const nay = new Date()
    const f = String(q.from || '')
    const t = String(q.to || '')
    const from = /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : `${nay.getFullYear()}-01-01`
    const to = /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ngay(nay)
    return {
        from, to,
        start: new Date(`${from}T00:00:00.000Z`),
        // Lấy tới hết ngày `to` theo giờ VN (UTC+7) — cắt ở 00:00 UTC sẽ rụng
        // các đơn buổi chiều tối của chính ngày cuối kỳ.
        end: new Date(new Date(`${to}T23:59:59.999Z`).getTime() + 7 * 3600 * 1000),
    }
}

/** Số dư một nhóm tài khoản theo tiền tố, tính tới hết ngày `to` */
function soDuTheoTienTo(entries: Array<{ debitAccount: string; creditAccount: string; amount: number }>, tienTo: string) {
    let no = 0, co = 0
    for (const e of entries) {
        if (String(e.debitAccount || '').startsWith(tienTo)) no += e.amount
        if (String(e.creditAccount || '').startsWith(tienTo)) co += e.amount
    }
    return { no, co, du: no - co }
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET /reconcile — soát sổ
// ═══════════════════════════════════════════════════════════════════════════
router.get('/reconcile', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { from, to, start, end } = khoangNgay(req.query)
        const vanDe: VanDe[] = []

        /* Tải tất cả reference của bút toán trong kỳ MỘT LẦN rồi so trong bộ nhớ.
         * Pool Prisma mỗi cửa hàng rất nhỏ nên tuyệt đối không truy vấn theo
         * từng phiếu (một kỳ vài nghìn phiếu là cạn kết nối, sập cả dashboard). */
        const butToanKy: Array<{ reference: string | null; debitAccount: string; creditAccount: string; amount: number; referenceType: string | null }> =
            await prisma.journalEntry.findMany({
                where: { date: { gte: from, lte: to } },
                select: { reference: true, debitAccount: true, creditAccount: true, amount: true, referenceType: true },
            })
        const refCo = new Set(butToanKy.map(e => e.reference).filter(Boolean) as string[])
        // Bút toán đảo: có VOID-<ref> nghĩa là <ref> đã bị hủy, không tính là "đã ghi"
        const daDao = new Set(
            Array.from(refCo).filter(r => r.startsWith('VOID-')).map(r => r.slice(5)),
        )
        const daGhi = (ref: string) => refCo.has(ref) && !daDao.has(ref)

        // ─── 1. Hóa đơn bán chưa vào sổ ──────────────────────────────────────
        const banChuaGhi: Array<{ receiptNumber: string; total: number }> = []
        {
            const txs = await prisma.transaction.findMany({
                where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } },
                select: { receiptNumber: true, total: true },
            })
            for (const t of txs) if (!daGhi(`SALE-${t.receiptNumber}`)) banChuaGhi.push(t)
            if (banChuaGhi.length > 0) vanDe.push({
                code: 'ban-chua-ghi', muc: 'cao',
                tieuDe: `${banChuaGhi.length} hóa đơn bán chưa vào sổ`,
                chiTiet: `Tổng ${banChuaGhi.reduce((s, t) => s + (t.total || 0), 0).toLocaleString('vi-VN')} ₫ doanh thu chưa có bút toán — Báo cáo kết quả kinh doanh đang thiếu đúng khoản này.`,
                tien: banChuaGhi.reduce((s, t) => s + (t.total || 0), 0),
                soLuong: banChuaGhi.length,
                viDu: banChuaGhi.slice(0, 5).map(t => t.receiptNumber),
                ghiBuDuoc: true,
            })
        }

        // ─── 2. Phiếu nhập chưa vào sổ ───────────────────────────────────────
        const nhapChuaGhi: Array<{ code: string; totalCost: number }> = []
        {
            const imps = await prisma.importReceipt.findMany({
                where: { status: 'completed', createdAt: { gte: start, lte: end } },
                select: { code: true, totalCost: true },
            })
            for (const i of imps) if (!daGhi(`IMP-${i.code}`)) nhapChuaGhi.push(i)
            if (nhapChuaGhi.length > 0) vanDe.push({
                code: 'nhap-chua-ghi', muc: 'cao',
                tieuDe: `${nhapChuaGhi.length} phiếu nhập chưa vào sổ`,
                chiTiet: `Tổng ${nhapChuaGhi.reduce((s, i) => s + (i.totalCost || 0), 0).toLocaleString('vi-VN')} ₫ hàng nhập chưa ghi Nợ 156 / Có 331 — tồn kho và công nợ nhà cung cấp trên sổ đều thiếu.`,
                tien: nhapChuaGhi.reduce((s, i) => s + (i.totalCost || 0), 0),
                soLuong: nhapChuaGhi.length,
                viDu: nhapChuaGhi.slice(0, 5).map(i => i.code),
                ghiBuDuoc: true,
            })
        }

        // ─── 3. Chi phí chưa vào sổ ──────────────────────────────────────────
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
            if (chiChuaGhi.length > 0) vanDe.push({
                code: 'chi-chua-ghi', muc: 'cao',
                tieuDe: `${chiChuaGhi.length} khoản chi chưa vào sổ`,
                chiTiet: `Tổng ${chiChuaGhi.reduce((s, e) => s + (e.amount || 0), 0).toLocaleString('vi-VN')} ₫ chi phí chưa ghi sổ — lãi trên báo cáo đang cao hơn thực tế đúng bằng khoản này.`,
                tien: chiChuaGhi.reduce((s, e) => s + (e.amount || 0), 0),
                soLuong: chiChuaGhi.length,
                viDu: chiChuaGhi.slice(0, 5).map(e => e.description?.slice(0, 40) || e.id),
                ghiBuDuoc: true,
            })
        }

        // ─── 4. Phiếu trả hàng chưa vào sổ ───────────────────────────────────
        const traChuaGhi: Array<{ code: string; totalRefund: number }> = []
        {
            const rets = await prisma.returnOrder.findMany({
                where: { status: { in: ['refunded', 'exchanged'] }, createdAt: { gte: start, lte: end } },
                select: { code: true, totalRefund: true },
            })
            for (const r of rets) if (!daGhi(`RET-${r.code}`)) traChuaGhi.push(r)
            if (traChuaGhi.length > 0) vanDe.push({
                code: 'tra-chua-ghi', muc: 'cao',
                tieuDe: `${traChuaGhi.length} phiếu trả hàng chưa vào sổ`,
                chiTiet: `Tổng ${traChuaGhi.reduce((s, r) => s + (r.totalRefund || 0), 0).toLocaleString('vi-VN')} ₫ đã trả lại khách nhưng doanh thu trên sổ vẫn giữ nguyên.`,
                tien: traChuaGhi.reduce((s, r) => s + (r.totalRefund || 0), 0),
                soLuong: traChuaGhi.length,
                viDu: traChuaGhi.slice(0, 5).map(r => r.code),
                ghiBuDuoc: true,
            })
        }

        /* ─── 5. Đối chiếu SỐ DƯ SỔ với dữ liệu nghiệp vụ ────────────────────
         * Số dư phải lấy từ ĐẦU ĐẾN CUỐI KỲ (lũy kế), không phải chỉ trong kỳ —
         * so số dư lũy kế với số thực tế hiện tại mới có ý nghĩa. */
        const butToanLuyKe: Array<{ debitAccount: string; creditAccount: string; amount: number }> =
            await prisma.journalEntry.findMany({
                where: { date: { lte: to } },
                select: { debitAccount: true, creditAccount: true, amount: true },
            })

        // 5a. Phải thu khách hàng (131) vs tổng công nợ khách
        {
            const so = soDuTheoTienTo(butToanLuyKe, '131').du
            const agg = await prisma.customer.aggregate({ _sum: { debt: true } })
            const that = Math.round(agg._sum.debt || 0)
            const lech = Math.round(so) - that
            if (Math.abs(lech) >= 1000) vanDe.push({
                code: 'lech-131', muc: Math.abs(lech) > that * 0.1 ? 'cao' : 'vua',
                tieuDe: 'Phải thu khách hàng trên sổ lệch với công nợ thực tế',
                chiTiet: `Sổ TK 131 dư ${Math.round(so).toLocaleString('vi-VN')} ₫, tổng nợ trên hồ sơ khách là ${that.toLocaleString('vi-VN')} ₫ — lệch ${Math.abs(lech).toLocaleString('vi-VN')} ₫. Thường do thu nợ ghi thẳng vào sổ quỹ mà quên bút toán, hoặc sửa nợ khách bằng tay.`,
                tien: Math.abs(lech), soLuong: 0, viDu: [], ghiBuDuoc: false,
            })
        }

        // 5b. Phải trả người bán (331) vs công nợ NCC còn lại
        {
            const so = -soDuTheoTienTo(butToanLuyKe, '331').du // 331 dư Có
            const imps = await prisma.importReceipt.findMany({
                where: { status: 'completed', paymentStatus: { in: ['unpaid', 'partial'] } },
                select: { totalCost: true, paidAmount: true },
            })
            const that = Math.round(imps.reduce((s: number, i: any) => s + Math.max(0, (i.totalCost || 0) - (i.paidAmount || 0)), 0))
            const lech = Math.round(so) - that
            if (Math.abs(lech) >= 1000) vanDe.push({
                code: 'lech-331', muc: Math.abs(lech) > Math.max(that, 1) * 0.1 ? 'cao' : 'vua',
                tieuDe: 'Phải trả người bán trên sổ lệch với công nợ nhà cung cấp',
                chiTiet: `Sổ TK 331 dư Có ${Math.round(so).toLocaleString('vi-VN')} ₫, tổng còn nợ trên phiếu nhập là ${that.toLocaleString('vi-VN')} ₫ — lệch ${Math.abs(lech).toLocaleString('vi-VN')} ₫. Hay gặp khi phiếu nhập cũ chưa được ghi sổ, hoặc trả tiền NCC không qua chức năng thanh toán phiếu.`,
                tien: Math.abs(lech), soLuong: imps.length, viDu: [], ghiBuDuoc: false,
            })
        }

        // 5c. Hàng hóa (156) vs giá trị tồn kho thực tế
        {
            const so = soDuTheoTienTo(butToanLuyKe, '156').du
            const sps = await prisma.product.findMany({ select: { stock: true, costPrice: true } })
            const that = Math.round(sps.reduce((s: number, p: any) => s + Math.max(0, p.stock || 0) * (p.costPrice || 0), 0))
            const lech = Math.round(so) - that
            if (Math.abs(lech) >= 1000) vanDe.push({
                code: 'lech-156', muc: Math.abs(lech) > Math.max(that, 1) * 0.15 ? 'cao' : 'vua',
                tieuDe: 'Giá trị hàng hóa trên sổ lệch với tồn kho thực tế',
                chiTiet: `Sổ TK 156 dư ${Math.round(so).toLocaleString('vi-VN')} ₫, tồn kho tính theo giá vốn hiện tại là ${that.toLocaleString('vi-VN')} ₫ — lệch ${Math.abs(lech).toLocaleString('vi-VN')} ₫. Nguyên nhân thường gặp: phiếu nhập chưa ghi sổ, điều chỉnh kho thủ công, hoặc giá vốn được cập nhật lại sau khi đã bán.`,
                tien: Math.abs(lech), soLuong: 0, viDu: [], ghiBuDuoc: false,
            })
        }

        // 5d. Quỹ tiền mặt âm — dấu hiệu chi vượt quỹ hoặc thiếu bút toán thu
        {
            const q = soDuTheoTienTo(butToanLuyKe, '111').du
            if (q < -1000) vanDe.push({
                code: 'quy-am', muc: 'cao',
                tieuDe: 'Sổ quỹ tiền mặt đang ÂM',
                chiTiet: `TK 111 dư ${Math.round(q).toLocaleString('vi-VN')} ₫. Quỹ tiền mặt không thể âm trên thực tế — hoặc thiếu bút toán thu, hoặc có khoản chi ghi trùng.`,
                tien: Math.abs(Math.round(q)), soLuong: 0, viDu: [], ghiBuDuoc: false,
            })
        }

        // ─── 6. Bút toán bất thường trong kỳ ─────────────────────────────────
        {
            const xau = butToanKy.filter(e =>
                !e.amount || e.amount <= 0 ||
                !e.debitAccount || !e.creditAccount ||
                e.debitAccount === e.creditAccount)
            if (xau.length > 0) vanDe.push({
                code: 'but-toan-xau', muc: 'vua',
                tieuDe: `${xau.length} bút toán không hợp lệ`,
                chiTiet: 'Có bút toán số tiền ≤ 0, thiếu tài khoản, hoặc ghi Nợ và Có cùng một tài khoản (không làm thay đổi gì nhưng làm phồng sổ nhật ký).',
                tien: null, soLuong: xau.length,
                viDu: xau.slice(0, 5).map(e => e.reference || '(không mã)'),
                ghiBuDuoc: false,
            })
        }

        // ─── 7. Bút toán rơi vào kỳ đã khóa sổ ───────────────────────────────
        try {
            const khoa = await prisma.periodLock.findMany({ select: { year: true, month: true, isLocked: true } })
            const kyKhoa = new Set(
                khoa.filter((k: any) => k.isLocked).map((k: any) => `${k.year}-${String(k.month).padStart(2, '0')}`),
            )
            if (kyKhoa.size > 0) {
                const phamKhoa = await prisma.journalEntry.findMany({
                    where: { date: { gte: from, lte: to }, createdAt: { gte: start } },
                    select: { reference: true, date: true },
                })
                const pham = phamKhoa.filter((e: any) => kyKhoa.has(String(e.date).slice(0, 7)))
                if (pham.length > 0) vanDe.push({
                    code: 'ghi-vao-ky-khoa', muc: 'cao',
                    tieuDe: `${pham.length} bút toán ghi vào kỳ đã khóa sổ`,
                    chiTiet: 'Kỳ đã khóa mà vẫn có bút toán mới mang ngày trong kỳ đó — số liệu đã nộp cho cơ quan thuế và số trên sổ sẽ không còn khớp nhau.',
                    tien: null, soLuong: pham.length,
                    viDu: pham.slice(0, 5).map((e: any) => `${e.reference || '(không mã)'} · ${e.date}`),
                    ghiBuDuoc: false,
                })
            }
        } catch { /* chưa có bảng PeriodLock — bỏ qua */ }

        const thuTu: Record<Muc, number> = { cao: 0, vua: 1, thap: 2 }
        vanDe.sort((a, b) => thuTu[a.muc] - thuTu[b.muc] || (b.tien ?? 0) - (a.tien ?? 0))

        res.json({
            success: true,
            data: {
                from, to,
                soVanDe: vanDe.length,
                soVanDeNang: vanDe.filter(v => v.muc === 'cao').length,
                ghiBuDuoc: vanDe.some(v => v.ghiBuDuoc),
                tongButToanKy: butToanKy.length,
                vanDe,
                /* Đếm chi tiết để giao diện hiện nút "Ghi bù" đúng số lượng */
                thieu: {
                    ban: banChuaGhi.length,
                    nhap: nhapChuaGhi.length,
                    chi: chiChuaGhi.length,
                    tra: traChuaGhi.length,
                },
            },
        })
    } catch (err) {
        console.error('Đối chiếu sổ sách lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═══════════════════════════════════════════════════════════════════════════
//  POST /reconcile/fix — ghi bù bút toán còn thiếu
//  Chỉ THÊM bút toán cho nghiệp vụ chưa có; không xóa, không sửa bút toán cũ.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/reconcile/fix', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { from, to, start, end } = khoangNgay(req.body || {})
        const userId = req.user?.userId || null
        const daTao: Array<{ type: string; ref: string; amount: number }> = []

        const cu: Array<{ reference: string | null }> = await prisma.journalEntry.findMany({
            where: { date: { gte: from, lte: to } }, select: { reference: true },
        })
        const refCo = new Set(cu.map(e => e.reference).filter(Boolean) as string[])
        const daDao = new Set(Array.from(refCo).filter(r => r.startsWith('VOID-')).map(r => r.slice(5)))
        const daGhi = (ref: string) => refCo.has(ref) && !daDao.has(ref)

        const _bt = (await prisma.storeSettings.findFirst({ select: { businessType: true } }).catch(() => null))?.businessType || 'company'
        const vatKhauTru = !(_bt === 'household' || _bt === 'individual')

        // Hóa đơn bán
        const txs = await prisma.transaction.findMany({
            where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } },
            include: { payments: true, items: { include: { product: { select: { costPrice: true } } } } },
        })
        for (const t of txs) {
            if (daGhi(`SALE-${t.receiptNumber}`)) continue
            const r = await createJournalEntriesForTransaction(prisma, t as any, { branchId: t.branchId ?? null, userId, skipDupCheck: true })
            daTao.push(...r.created)
        }

        // Phiếu nhập
        const imps = await prisma.importReceipt.findMany({
            where: { status: 'completed', createdAt: { gte: start, lte: end } },
        })
        for (const i of imps) {
            if (daGhi(`IMP-${i.code}`)) continue
            const r = await postImportReceiptJournal(prisma, i as any, { branchId: i.branchId ?? null, userId, vatKhauTru })
            daTao.push(...r.created)
        }

        // Chi phí
        const exps = await prisma.expense.findMany({ where: { date: { gte: start, lte: end } } })
        for (const e of exps) {
            if (e.status === 'cancelled' || e.status === 'pending') continue
            if (daGhi(`EXP-${e.id}`)) continue
            const r = await postExpenseJournal(prisma, e as any, { branchId: e.branchId ?? null, userId, vatKhauTru })
            daTao.push(...r.created)
        }

        // Phiếu trả hàng
        const rets = await prisma.returnOrder.findMany({
            where: { status: { in: ['refunded', 'exchanged'] }, createdAt: { gte: start, lte: end } },
            include: { items: true },
        })
        for (const ret of rets) {
            if (daGhi(`RET-${ret.code}`)) continue
            let giaVon = 0
            for (const it of (ret as any).items ?? []) {
                if (!it.productId || !it.restocked) continue
                const p = await prisma.product.findUnique({ where: { id: it.productId }, select: { costPrice: true } })
                giaVon += (p?.costPrice ?? 0) * (it.quantity ?? 0)
            }
            let vatTra = 0
            if (ret.transactionId) {
                const goc = await prisma.transaction.findUnique({ where: { id: ret.transactionId }, select: { tax: true, total: true } })
                if (goc && goc.total > 0 && goc.tax > 0) vatTra = Math.round((ret.totalRefund || 0) * (goc.tax / goc.total))
            }
            const r = await postReturnJournal(prisma, {
                code: ret.code, customerName: ret.customerName, originalInvoice: ret.originalInvoice,
                totalRefund: ret.totalRefund || 0, refundMethod: ret.refundMethod,
                costValue: giaVon, vatAmount: vatTra, branchId: ret.branchId, createdAt: ret.createdAt,
            }, { branchId: ret.branchId ?? null, userId })
            daTao.push(...r.created)
        }

        res.json({
            success: true,
            data: {
                from, to,
                soButToan: daTao.length,
                tongTien: daTao.reduce((s, e) => s + (e.amount || 0), 0),
                theoLoai: daTao.reduce((m: Record<string, number>, e) => { m[e.type] = (m[e.type] ?? 0) + 1; return m }, {}),
            },
        })
    } catch (err) {
        console.error('Ghi bù bút toán lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
