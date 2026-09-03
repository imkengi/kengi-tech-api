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
import { postImportReceiptJournal, postExpenseJournal, postReturnJournal, postStockAdjustJournal } from '../lib/autoJournalPurchase'
import { soatSoSach } from '../lib/reconcile'

const router = Router()

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

// ═══════════════════════════════════════════════════════════════════════════
//  GET /reconcile — soát sổ
// ═══════════════════════════════════════════════════════════════════════════
router.get('/reconcile', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const data = await soatSoSach(prisma, khoangNgay(req.query))
        res.json({ success: true, data })
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

        /* GHI BÙ VÀO KỲ ĐÃ KHOÁ (03/09/2026).
         * Hai bộ sinh bút toán nay chặn chứng từ rơi vào kỳ đã khoá sổ. Ghi bù chỉ
         * hoàn tất phần sổ còn thiếu của chứng từ đã có, nhưng VẪN làm đổi số của
         * kỳ đã khoá — nên phải do người dùng chủ động chọn. Không chọn thì trả
         * 423 kèm hướng dẫn, chứ không âm thầm bỏ sót. */
        const boQuaKhoaSo = req.body?.boQuaKhoaSo === true

        /* ── CHẠY THEO LÔ, KHÔNG ÔM HẾT MỘT LƯỢT ────────────────────────────
         *
         * Cloud Run cắt request ở 300 giây. Ghi bù cho một cửa hàng thiếu hàng
         * nghìn bút toán thì chắc chắn vượt: mỗi phiếu bán sinh 3–4 bút toán,
         * ghi tuần tự vì pool Prisma mỗi cửa hàng chỉ vài kết nối. Đo trên HUTI
         * ngày 14/08/2026: sổ mới ghi 1,2% doanh thu, tức còn gần như toàn bộ.
         *
         * Trước bản này, người dùng bấm Ghi bù rồi nhận đúng một dòng "Ghi bù
         * thất bại: timeout" — trong khi máy chủ ĐÃ ghi được hàng trăm bút toán
         * và chạy lại sẽ đi tiếp. Họ kết luận tính năng hỏng và bỏ luôn, đúng
         * cái cửa hàng cần nó nhất.
         *
         * Phép ghi vốn đã idempotent (bỏ qua ref đã có) nên chia lô là an toàn:
         * mỗi lượt xử một phần rồi báo phần còn lại. */
        const MOI_LO = Math.max(50, Math.min(2000, Number((req.body || {}).soChungTuMoiLo) || 400))
        let conLai = 0
        const conNguyen = <T,>(ds: T[], daXong: (x: T) => boolean, dung: number): T[] => {
            const chuaGhi = ds.filter(x => !daXong(x))
            conLai += Math.max(0, chuaGhi.length - dung)
            return chuaGhi.slice(0, dung)
        }
        let quota = MOI_LO

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
        const txsLo = conNguyen(txs, (t: any) => daGhi(`SALE-${t.receiptNumber}`), quota)
        quota -= txsLo.length
        for (const t of txsLo) {
            const r = await createJournalEntriesForTransaction(prisma, t as any, { branchId: t.branchId ?? null, userId, skipDupCheck: true, boQuaKhoaSo })
            daTao.push(...r.created)
        }

        // Phiếu nhập
        const imps = await prisma.importReceipt.findMany({
            where: { status: 'completed', createdAt: { gte: start, lte: end } },
        })
        const impsLo = conNguyen(imps, (i: any) => daGhi(`IMP-${i.code}`), Math.max(0, quota))
        quota -= impsLo.length
        for (const i of impsLo) {
            const r = await postImportReceiptJournal(prisma, i as any, { branchId: i.branchId ?? null, userId, vatKhauTru, boQuaKhoaSo })
            daTao.push(...r.created)
        }

        // Chi phí
        const exps = await prisma.expense.findMany({ where: { date: { gte: start, lte: end } } })
        const expsLo = conNguyen(
            exps.filter((e: any) => e.status !== 'cancelled' && e.status !== 'pending'),
            (e: any) => daGhi(`EXP-${e.id}`), Math.max(0, quota))
        quota -= expsLo.length
        for (const e of expsLo) {
            const r = await postExpenseJournal(prisma, e as any, { branchId: e.branchId ?? null, userId, vatKhauTru, boQuaKhoaSo })
            daTao.push(...r.created)
        }

        // Phiếu trả hàng
        const rets = await prisma.returnOrder.findMany({
            where: { status: { in: ['refunded', 'exchanged'] }, createdAt: { gte: start, lte: end } },
            include: { items: true },
        })
        const retsLo = conNguyen(rets, (r: any) => daGhi(`RET-${r.code}`), Math.max(0, quota))
        quota -= retsLo.length
        for (const ret of retsLo) {
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
            }, { branchId: ret.branchId ?? null, userId, boQuaKhoaSo })
            daTao.push(...r.created)
        }

        // Điều chỉnh/kiểm kê kho — giá vốn lấy theo giá hiện tại của sản phẩm
        try {
            const dcs = await prisma.inventoryTransaction.findMany({
                where: { type: 'adjustment', createdAt: { gte: start, lte: end } },
            })
            for (const d of dcs) {
                if (daGhi(`ADJ-${d.id}`)) continue
                const sp = d.productId
                    ? await prisma.product.findUnique({ where: { id: d.productId }, select: { costPrice: true } })
                    : null
                const r = await postStockAdjustJournal(prisma, {
                    id: d.id, productName: d.productName, quantity: d.quantity || 0,
                    costPrice: sp?.costPrice ?? d.unitPrice ?? 0,
                    reason: d.reason || d.note || null, date: d.createdAt,
                }, { userId, boQuaKhoaSo })
                daTao.push(...r.created)
            }
        } catch (e) { console.error('Ghi bù điều chỉnh kho lỗi (bỏ qua):', e) }

        res.json({
            success: true,
            data: {
                from, to,
                soButToan: daTao.length,
                tongTien: daTao.reduce((s, e) => s + (e.amount || 0), 0),
                theoLoai: daTao.reduce((m: Record<string, number>, e) => { m[e.type] = (m[e.type] ?? 0) + 1; return m }, {}),
                /* Còn bao nhiêu chứng từ chưa ghi sau lượt này. Giao diện dựa
                 * vào đây để nói "bấm lại để tiếp" thay vì để người dùng tưởng
                 * đã xong hoặc tưởng hỏng. */
                conLai,
                xong: conLai === 0,
                soChungTuMoiLo: MOI_LO,
            },
        })
    } catch (err: any) {
        if (err?.code === 'PERIOD_LOCKED') {
            res.status(423).json({
                success: false, code: 'PERIOD_LOCKED', lockDate: err.lockDate,
                error: `Kỳ kế toán đã khoá sổ đến ${err.lockDate}, nên không ghi bù bút toán vào kỳ đó. `
                    + 'Nếu thật sự muốn ghi bù vào kỳ đã khoá (số liệu của kỳ đã nộp sẽ đổi), '
                    + 'gửi lại kèm { "boQuaKhoaSo": true }.',
            })
            return
        }
        console.error('Ghi bù bút toán lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
