/**
 * SỨC KHOẺ TÀI CHÍNH KHÁCH HÀNG — dựng LẠI 20/08/2026.
 *
 * Bản gốc (18/08) là WIP chưa từng commit, bị `git reset` xoá mất phần backend
 * + hook; chỉ trang FE 572 dòng sống sót. File này viết lại theo đúng hợp đồng
 * trang đó khai báo — mọi con số và ngưỡng quyết ở ĐÂY, FE chỉ hiển thị.
 *
 * Ngữ nghĩa nợ (theo buildDebtHistory — nguồn sự thật của module khách):
 * - "Mua chịu" = đơn có payment type='credit'.
 * - "Phần treo" của một phiếu = total − Σ payment KHÔNG-credit (kể cả phiếu
 *   thu trả nợ về sau, vì chúng gắn vào transaction).
 * - Customer.debt là SỔ — nguồn sự thật duy nhất (khách KiotViet càng vậy).
 *   Tổng treo theo phiếu có thể LỚN HƠN sổ (khách trả gộp không gắn phiếu):
 *   khi sổ = 0 mà vẫn còn phiếu treo → "trả gộp, không phải nợ"
 *   (phieuTreoKhongPhaiNo) — FE sẽ bỏ tô đỏ toàn bộ.
 * - Tuổi nợ FIFO NEO SỔ: coi tiền đã trả trừ vào phiếu CŨ trước → dư nợ sổ
 *   phủ lên các phiếu MỚI nhất trước; phần sổ vượt quá tổng treo = "ngoài
 *   phiếu" (nợ đầu kỳ nhập tay). Tuổi nợ lâu nhất = phiếu CŨ nhất còn được
 *   phủ nợ sau phép chia đó.
 *
 * Hiệu năng: PRISMA_POOL_SIZE=1 — mỗi request chỉ vài truy vấn set-based,
 * tuyệt đối không N+1 theo khách.
 */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'

const router = Router()

const VN_MS = 7 * 3600_000
const NGAY_MS = 86_400_000
const vnYmd = (d: Date) => new Date(d.getTime() + VN_MS).toISOString().slice(0, 10)
const vnYm = (d: Date) => vnYmd(d).slice(0, 7)
const tuoiNgay = (d: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / NGAY_MS))
const lam1 = (x: number) => Math.round(x * 10) / 10

interface DongTx {
    id: string
    receiptNumber: string
    total: number
    createdAt: Date
    daThu: number   // Σ payment KHÔNG-credit
    coChiu: boolean // có payment credit
}

/** Nạp toàn bộ đơn (completed/partial) + tiền đã thu của MỘT khách — 2 truy vấn. */
async function napDonKhach(prisma: any, custId: string, name: string | null, phone: string | null): Promise<DongTx[]> {
    // Cùng luật match với buildDebtHistory: ưu tiên customerId, fallback
    // name/phone cho đơn cũ CHƯA gắn customerId.
    const or: any[] = [{ customerId: custId }]
    if (name) or.push({ customerId: null, customerName: name })
    if (phone) or.push({ customerId: null, customerPhone: phone })
    const txs = await prisma.transaction.findMany({
        where: { OR: or, status: { in: ['completed', 'partial'] } },
        select: { id: true, receiptNumber: true, total: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
    })
    if (txs.length === 0) return []
    const ids = txs.map((t: any) => t.id)
    // GROUP BY một lần thay vì include payments từng đơn
    const rows: any[] = await prisma.payment.groupBy({
        by: ['transactionId', 'type'],
        where: { transactionId: { in: ids } },
        _sum: { amount: true },
    })
    const daThu = new Map<string, number>()
    const coChiu = new Set<string>()
    for (const r of rows) {
        if (r.type === 'credit') { if ((r._sum?.amount ?? 0) > 0) coChiu.add(r.transactionId) }
        else daThu.set(r.transactionId, (daThu.get(r.transactionId) ?? 0) + (r._sum?.amount ?? 0))
    }
    return txs.map((t: any) => ({
        id: t.id, receiptNumber: t.receiptNumber, total: Number(t.total) || 0,
        createdAt: new Date(t.createdAt),
        daThu: daThu.get(t.id) ?? 0,
        coChiu: coChiu.has(t.id),
    }))
}

/** FIFO neo sổ: chia dư nợ SỔ lên các phiếu treo, MỚI trước (tiền trả đã trừ phiếu cũ). */
function chiaNoFifo(txs: DongTx[], duNoSo: number, now: Date) {
    const treo = txs
        .map(t => ({ t, con: Math.max(0, t.total - t.daThu) }))
        .filter(x => x.con > 0.5) // bỏ lẻ vài đồng làm tròn
    const tienTreoTheoPhieu = treo.reduce((s, x) => s + x.con, 0)
    let conLai = Math.max(0, duNoSo)
    const phu: { t: DongTx; tien: number }[] = []
    for (let i = treo.length - 1; i >= 0; i--) { // mới → cũ
        if (conLai <= 0.5) break
        const lay = Math.min(treo[i]!.con, conLai)
        phu.push({ t: treo[i]!.t, tien: lay })
        conLai -= lay
    }
    const ngoaiPhieu = Math.max(0, Math.round(conLai))
    const bac = { b0_30: 0, b31_60: 0, b61_90: 0, tren90: 0 }
    let cuNhat: DongTx | null = null
    let moiNhat: DongTx | null = null
    for (const p of phu) {
        const tuoi = tuoiNgay(p.t.createdAt, now)
        if (tuoi <= 30) bac.b0_30 += p.tien
        else if (tuoi <= 60) bac.b31_60 += p.tien
        else if (tuoi <= 90) bac.b61_90 += p.tien
        else bac.tren90 += p.tien
        if (!cuNhat || p.t.createdAt < cuNhat.createdAt) cuNhat = p.t
        if (!moiNhat || p.t.createdAt > moiNhat.createdAt) moiNhat = p.t
    }
    bac.b0_30 = Math.round(bac.b0_30); bac.b31_60 = Math.round(bac.b31_60)
    bac.b61_90 = Math.round(bac.b61_90); bac.tren90 = Math.round(bac.tren90)
    return {
        soPhieuTreo: treo.length,
        tienTreoTheoPhieu: Math.round(tienTreoTheoPhieu),
        ngayNoLauNhat: cuNhat ? tuoiNgay(cuNhat.createdAt, now) : null,
        ngayNoGanNhat: moiNhat ? tuoiNgay(moiNhat.createdAt, now) : null,
        phieuTreoGanNhat: moiNhat?.receiptNumber ?? null,
        bacTuoi: bac,
        ngoaiPhieu,
    }
}

/** Nhịp mua + xu hướng 3 tháng + độ lớn đơn — tất cả trên 12 tháng gần nhất. */
function tinhMoRong(txs12: DongTx[], now: Date) {
    const ngayCo = [...new Set(txs12.map(t => vnYmd(t.createdAt)))].sort()
    let nhip: number | null = null
    if (ngayCo.length >= 2) {
        const dau = new Date(ngayCo[0]!), cuoi = new Date(ngayCo[ngayCo.length - 1]!)
        nhip = Math.round((cuoi.getTime() - dau.getTime()) / NGAY_MS / (ngayCo.length - 1))
    }
    const lanCuoi = txs12.length ? txs12[txs12.length - 1]!.createdAt : null
    const ngayTuLanCuoi = lanCuoi ? tuoiNgay(lanCuoi, now) : null
    // Im lâu = vượt xa nhịp quen (2× nhịp, sàn 30 ngày) và có đủ lịch sử để nói
    const dangImLau = ngayTuLanCuoi !== null && nhip !== null && txs12.length >= 3
        && ngayTuLanCuoi > Math.max(nhip * 2, 30)

    // Xu hướng: 3 tháng gần nhất vs 3 tháng liền trước
    const moc3 = new Date(now.getTime() - 90 * NGAY_MS)
    const moc6 = new Date(now.getTime() - 180 * NGAY_MS)
    const gan = txs12.filter(t => t.createdAt >= moc3)
    const truoc = txs12.filter(t => t.createdAt >= moc6 && t.createdAt < moc3)
    const tienGan = gan.reduce((s, t) => s + t.total, 0)
    const tienTruoc = truoc.reduce((s, t) => s + t.total, 0)
    const tangTruongTien = tienTruoc > 0 ? (tienGan - tienTruoc) / tienTruoc : null
    const tangTruongDon = truoc.length > 0 ? (gan.length - truoc.length) / truoc.length : null
    const nhanXuHuong: 'tang' | 'giam' | 'on-dinh' | 'chua-du' =
        tangTruongTien === null ? 'chua-du'
            : tangTruongTien >= 0.1 ? 'tang'
                : tangTruongTien <= -0.1 ? 'giam' : 'on-dinh'

    // Độ lớn đơn
    const totals = txs12.map(t => t.total).sort((a, b) => a - b)
    const tb = totals.length ? totals.reduce((s, x) => s + x, 0) / totals.length : 0
    const trungVi = totals.length
        ? (totals.length % 2 ? totals[(totals.length - 1) / 2]! : (totals[totals.length / 2 - 1]! + totals[totals.length / 2]!) / 2)
        : 0
    const lonNhat = totals.length ? totals[totals.length - 1]! : 0
    const tbGan = gan.length ? tienGan / gan.length : null
    const heSo3ThangGanNhat = tbGan !== null && tb > 0 ? lam1(tbGan / tb) : null

    return {
        nhipMua: { tbNgayGiuaHaiLan: nhip, soNgayCoMua: ngayCo.length, ngayTuLanCuoi, dangImLau },
        xuHuong: { nhan: nhanXuHuong, tangTruongTien, tangTruongDon },
        doLonDon: { tb: Math.round(tb), trungVi: Math.round(trungVi), lonNhat: Math.round(lonNhat), heSo3ThangGanNhat },
    }
}

/**
 * Điểm 0–100 = 4 thành phần × 25. LUÔN tính trên 12 tháng (một khách một
 * điểm, không đổi theo kỳ đang xem) và bị NÉN vào dải theo cảnh báo nợ
 * (rủi ro ≤39, theo dõi ≤59) để hai thứ không bao giờ cãi nhau.
 */
function chamDiem(opts: {
    duNo: number; tongMua12: number; ngayNoLauNhat: number | null
    tangTruongTien: number | null; dangImLau: boolean
    tiLeMuaChiu12: number; soDon12: number
    xepHang: 'tot' | 'theo-doi' | 'rui-ro' | 'chua-du-du-lieu'
    traGop: boolean
}) {
    const { duNo, tongMua12, ngayNoLauNhat, tangTruongTien, dangImLau, tiLeMuaChiu12, soDon12, xepHang, traGop } = opts
    if (xepHang === 'chua-du-du-lieu') return null

    // 1. Gánh nợ: nợ ÷ tổng mua 12t — 0% ăn trọn, ≥50% về 0. Trả gộp = không nợ.
    const rNo = traGop || duNo <= 0 ? 0 : tongMua12 > 0 ? duNo / tongMua12 : 1
    const dGanh = Math.round(25 * (1 - Math.min(1, rNo / 0.5)))
    // 2. Tuổi nợ: 0 ngày ăn trọn, tuyến tính về 0 tại 90 ngày.
    const tuoi = traGop ? 0 : (ngayNoLauNhat ?? (duNo > 0 ? 90 : 0)) // nợ ngoài phiếu không rõ tuổi → coi như già
    const dTuoi = Math.round(25 * (1 - Math.min(1, tuoi / 90)))
    // 3. Xu hướng & nhịp
    let dXu = tangTruongTien === null ? 15
        : tangTruongTien >= 0.1 ? 25
            : tangTruongTien > -0.1 ? 20
                : tangTruongTien > -0.3 ? 12 : 5
    if (dangImLau) dXu = Math.max(0, dXu - 7)
    // 4. Mua chịu trong kỳ (12t): 0% ăn trọn, ≥60% đơn chịu về 0. Trả gộp miễn trừ.
    const dChiu = Math.round(25 * (1 - Math.min(1, (traGop ? 0 : tiLeMuaChiu12) / 0.6)))

    let tong = dGanh + dTuoi + dXu + dChiu
    let biChanTran = false
    let lyDoChan: string | null = null
    if (xepHang === 'rui-ro' && tong > 39) { tong = 39; biChanTran = true; lyDoChan = 'Điểm bị nén xuống dải D vì cảnh báo nợ RỦI RO (nợ quá 90 ngày) — trả bớt nợ cũ thì điểm tự bung.' }
    if (xepHang === 'theo-doi' && tong > 59) { tong = 59; biChanTran = true; lyDoChan = 'Điểm bị nén xuống dải C vì cảnh báo nợ THEO DÕI — xử lý nợ quá hạn thì điểm tự bung.' }

    const hang: 'A' | 'B' | 'C' | 'D' = tong >= 80 ? 'A' : tong >= 60 ? 'B' : tong >= 40 ? 'C' : 'D'
    const nhan = hang === 'A' ? 'Rất tốt' : hang === 'B' ? 'Ổn' : hang === 'C' ? 'Cần để ý' : 'Yếu'
    const doTinCay: 'thap' | 'vua' | 'cao' = soDon12 < 3 ? 'thap' : soDon12 < 10 ? 'vua' : 'cao'
    const lyDoTinCay = doTinCay === 'thap'
        ? `Chỉ ${soDon12} đơn trong 12 tháng — điểm tham khảo, chưa đáng tin`
        : doTinCay === 'vua' ? `${soDon12} đơn trong 12 tháng — độ tin cậy vừa` : `${soDon12} đơn trong 12 tháng — đủ dữ liệu`

    return {
        tong, hang, nhan, doTinCay, lyDoTinCay, biChanTran, lyDoChan,
        thanhPhan: [
            { ma: 'ganh-no', ten: 'Gánh nợ', diem: dGanh, toiDa: 25, giaiThich: traGop ? 'Sổ không nợ (phiếu treo là trả gộp)' : duNo <= 0 ? 'Không nợ theo sổ' : `Nợ bằng ${Math.round(rNo * 100)}% tổng mua 12 tháng (≥50% là 0đ)` },
            { ma: 'tuoi-no', ten: 'Tuổi nợ', diem: dTuoi, toiDa: 25, giaiThich: traGop || duNo <= 0 ? 'Không có nợ để tính tuổi' : ngayNoLauNhat === null ? 'Nợ ngoài phiếu — không rõ tuổi, coi như già' : `Phiếu nợ cũ nhất ${ngayNoLauNhat} ngày (90 ngày là 0đ)` },
            { ma: 'xu-huong', ten: 'Xu hướng & nhịp', diem: dXu, toiDa: 25, giaiThich: (tangTruongTien === null ? 'Chưa đủ 3 tháng trước để so' : `Tiền mua 3 tháng gần ${tangTruongTien >= 0 ? '+' : ''}${Math.round(tangTruongTien * 100)}% so với 3 tháng trước`) + (dangImLau ? ' · đang IM LÂU (−7đ)' : '') },
            { ma: 'mua-chiu', ten: 'Mua chịu trong kỳ', diem: dChiu, toiDa: 25, giaiThich: traGop ? 'Trả gộp — không tính mua chịu' : `${Math.round(tiLeMuaChiu12 * 100)}% đơn 12 tháng là mua chịu (≥60% là 0đ)` },
        ],
    }
}

/** Cảnh báo nợ theo luật cứng — tách bạch với điểm. */
function xepHangNo(duNo: number, ngayNoLauNhat: number | null, traGop: boolean, coDuLieu: boolean):
    'tot' | 'theo-doi' | 'rui-ro' | 'chua-du-du-lieu' {
    if (!coDuLieu && duNo <= 0) return 'chua-du-du-lieu'
    if (traGop || duNo <= 0) return 'tot'
    if (ngayNoLauNhat === null) return 'theo-doi' // nợ ngoài phiếu, không rõ tuổi
    if (ngayNoLauNhat > 90) return 'rui-ro'
    if (ngayNoLauNhat > 30) return 'theo-doi'
    return 'tot'
}

// ─── GET /api/customers/financial-overview ───────────────────────────────────
// Bảng tổng quan MỌI khách (có mua 12 tháng hoặc có nợ) — set-based, không N+1.
router.get('/financial-overview', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        /* LẤY HẾT, KHÔNG ĐẶT TRẦN.
         *
         * Trần nào cũng là một con số bịa: 300 làm cửa hàng 343 khách mất 43 người, nâng lên
         * 2000 thì cửa hàng 2001 khách lại mất 1 — và lần nào cũng phải đợi chủ shop phát hiện
         * rồi báo. Đây là màn hình ĐÁNH GIÁ CÔNG NỢ; bỏ sót một khách nợ nặng là bỏ sót đúng
         * người cần nhìn nhất.
         *
         * Chi phí KHÔNG tăng theo số khách: vẫn đúng 3 lượt truy vấn (đếm + danh sách khách +
         * đơn hàng), phần chấm điểm chạy trong bộ nhớ.
         *
         * Vẫn nhận `?limit=` cho nơi nào chủ động muốn cắt — và khi đó `biCat` sẽ bật để màn
         * hình nói ra. Không truyền thì lấy hết. */
        const limitTho = Number(req.query.limit)
        const limit = Number.isFinite(limitTho) && limitTho > 0 ? Math.max(20, limitTho) : null
        const now = new Date()
        const moc12 = new Date(now.getTime() - 365 * NGAY_MS)

        // 1) Khung khách: có nợ HOẶC có mua 12 tháng — ưu tiên nợ lớn rồi mua lớn
        const khach: any[] = await prisma.$queryRawUnsafe(`
            SELECT c.id, c.name, c.code, c.phone, c.debt,
                   COALESCE(m."tongMua", 0)::float8 AS "tongMua12",
                   COALESCE(m."soDon", 0)::int AS "soDon12"
            FROM "Customer" c
            LEFT JOIN (
                SELECT "customerId", SUM(total) AS "tongMua", COUNT(*) AS "soDon"
                FROM "Transaction"
                WHERE status IN ('completed','partial') AND "createdAt" >= $1 AND "customerId" IS NOT NULL
                GROUP BY "customerId"
            ) m ON m."customerId" = c.id
            WHERE c.debt > 0 OR m."customerId" IS NOT NULL
            ORDER BY c.debt DESC, COALESCE(m."tongMua",0) DESC
            ${limit ? `LIMIT ${limit}` : ''}
        `, moc12)

        /* ĐẾM TỔNG THẬT (trước LIMIT). Không có con số này thì việc bị cắt là VÔ HÌNH:
         * `tong: items.length` luôn khớp với số dòng trả về, nên màn hình không bao giờ
         * biết mình đang chấm thiếu người. */
        const demRows: any[] = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*)::int AS n
            FROM "Customer" c
            LEFT JOIN (
                SELECT "customerId"
                FROM "Transaction"
                WHERE status IN ('completed','partial') AND "createdAt" >= $1 AND "customerId" IS NOT NULL
                GROUP BY "customerId"
            ) m ON m."customerId" = c.id
            WHERE c.debt > 0 OR m."customerId" IS NOT NULL
        `, moc12).catch(() => [])
        const tongTatCa = Number(demRows?.[0]?.n) || khach.length

        if (khach.length === 0) {
            res.json({ success: true, data: { tong: 0, tongTatCa, biCat: tongTatCa > 0, items: [] } })
            return
        }
        const ids = khach.map(k => k.id)

        // 2) Toàn bộ đơn 12 tháng của các khách đó (một lần) + payment gộp
        const txs: any[] = await prisma.transaction.findMany({
            where: { customerId: { in: ids }, status: { in: ['completed', 'partial'] }, createdAt: { gte: moc12 } },
            select: { id: true, customerId: true, receiptNumber: true, total: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        })
        const payRows: any[] = txs.length ? await prisma.payment.groupBy({
            by: ['transactionId', 'type'],
            where: { transactionId: { in: txs.map(t => t.id) } },
            _sum: { amount: true },
        }) : []
        const daThu = new Map<string, number>()
        const coChiu = new Set<string>()
        for (const r of payRows) {
            if (r.type === 'credit') { if ((r._sum?.amount ?? 0) > 0) coChiu.add(r.transactionId) }
            else daThu.set(r.transactionId, (daThu.get(r.transactionId) ?? 0) + (r._sum?.amount ?? 0))
        }
        const theoKhach = new Map<string, DongTx[]>()
        for (const t of txs) {
            const d: DongTx = { id: t.id, receiptNumber: t.receiptNumber, total: Number(t.total) || 0, createdAt: new Date(t.createdAt), daThu: daThu.get(t.id) ?? 0, coChiu: coChiu.has(t.id) }
            const arr = theoKhach.get(t.customerId) ?? []
            arr.push(d); theoKhach.set(t.customerId, arr)
        }

        const items = khach.map(k => {
            const ds = theoKhach.get(k.id) ?? []
            const duNo = Math.round(Number(k.debt) || 0)
            const fifo = chiaNoFifo(ds, duNo, now)
            const traGop = duNo <= 0 && fifo.soPhieuTreo > 0
            const mr = tinhMoRong(ds, now)
            const thangCo = new Set(ds.map(t => vnYm(t.createdAt))).size
            const tongMua12 = ds.reduce((s, t) => s + t.total, 0)
            const tbThang = thangCo > 0 ? tongMua12 / thangCo : 0
            const tiLeChiu = ds.length ? ds.filter(t => t.coChiu).length / ds.length : 0
            const hangNo = xepHangNo(duNo, fifo.ngayNoLauNhat, traGop, ds.length > 0)
            const diem = chamDiem({
                duNo, tongMua12, ngayNoLauNhat: fifo.ngayNoLauNhat,
                tangTruongTien: mr.xuHuong.tangTruongTien, dangImLau: mr.nhipMua.dangImLau,
                tiLeMuaChiu12: tiLeChiu, soDon12: ds.length, xepHang: hangNo, traGop,
            })
            return {
                id: k.id, ten: k.name, ma: k.code ?? null, sdt: k.phone ?? null,
                duNo,
                ngayNoLauNhat: traGop ? null : fifo.ngayNoLauNhat,
                noBangMayThang: duNo > 0 && tbThang > 0 ? lam1(duNo / tbThang) : null,
                tbThang: Math.round(tbThang),
                soDon12t: ds.length,
                ngayTuLanCuoi: mr.nhipMua.ngayTuLanCuoi,
                nhipMua: mr.nhipMua.tbNgayGiuaHaiLan,
                imLau: mr.nhipMua.dangImLau,
                xuHuong: mr.xuHuong.tangTruongTien,
                nhanXuHuong: mr.xuHuong.nhan,
                diem: diem?.tong ?? null,
                hang: diem?.hang ?? null,
                nhanDiem: diem?.nhan ?? null,
                biChanTran: diem?.biChanTran ?? false,
                doTinCay: diem?.doTinCay ?? null,
                phieuTreoKhongPhaiNo: traGop,
                soPhieuTreo: fifo.soPhieuTreo,
            }
        })
        // biCat = ĐANG CHẤM THIẾU NGƯỜI. Màn hình phải nói ra, đừng để tưởng đã soi hết.
        res.json({
            success: true,
            data: { tong: items.length, tongTatCa, biCat: tongTatCa > items.length, items },
        })
    } catch (err: any) {
        console.error('[financial-overview]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không dựng được bảng tổng quan' })
    }
})

// ─── GET /api/customers/:id/financial-health?months=12|6|0 ───────────────────
router.get('/:id/financial-health', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const custId = String(req.params.id)
        const monthsRaw = Number(req.query.months)
        const soThangKy = monthsRaw === 6 ? 6 : monthsRaw === 0 ? 0 : 12
        const now = new Date()

        const kh = await prisma.customer.findFirst({
            where: { id: custId },
            select: { id: true, name: true, phone: true, debt: true },
        })
        if (!kh) { res.status(404).json({ success: false, error: 'Không tìm thấy khách' }); return }

        const tatCa = await napDonKhach(prisma, custId, kh.name, kh.phone)
        const duNo = Math.round(Number(kh.debt) || 0)
        const fifo = chiaNoFifo(tatCa, duNo, now)
        const traGop = duNo <= 0 && fifo.soPhieuTreo > 0

        const moc12 = new Date(now.getTime() - 365 * NGAY_MS)
        const ds12 = tatCa.filter(t => t.createdAt >= moc12)
        const mr = tinhMoRong(ds12, now)

        // Kỳ đang xem (12/6/0=tất cả) — chỉ ảnh hưởng bảng tháng + tổng hợp kỳ
        const mocKy = soThangKy === 0 ? null : new Date(now.getTime() - soThangKy * 30.44 * NGAY_MS)
        const dsKy = mocKy ? tatCa.filter(t => t.createdAt >= mocKy) : tatCa

        // Theo tháng (VN +7)
        const thangMap = new Map<string, { soDon: number; tienMua: number; soDonChiu: number; tienNo: number }>()
        for (const t of dsKy) {
            const ym = vnYm(t.createdAt)
            const o = thangMap.get(ym) ?? { soDon: 0, tienMua: 0, soDonChiu: 0, tienNo: 0 }
            o.soDon++; o.tienMua += t.total
            if (t.coChiu) o.soDonChiu++
            o.tienNo += Math.max(0, t.total - t.daThu)
            thangMap.set(ym, o)
        }
        const theoThang = [...thangMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([thang, o]) => ({
            thang,
            soDon: o.soDon,
            tienMua: Math.round(o.tienMua),
            soDonChiu: o.soDonChiu,
            tiLeDonChiu: o.soDon > 0 ? o.soDonChiu / o.soDon : 0,
            tienNoPhatSinh: Math.round(o.tienNo),
            tiLeNoTrenMua: o.tienMua > 0 ? o.tienNo / o.tienMua : 0,
        }))

        const tienMuaKy = dsKy.reduce((s, t) => s + t.total, 0)
        const tienNoKy = dsKy.reduce((s, t) => s + Math.max(0, t.total - t.daThu), 0)
        const thangCoMua = thangMap.size
        const tongHopKy = {
            tbTienMuaThang: thangCoMua > 0 ? Math.round(tienMuaKy / thangCoMua) : 0,
            tbSoDonThang: thangCoMua > 0 ? lam1(dsKy.length / thangCoMua) : 0,
            tiLeNoTrenMuaKy: tienMuaKy > 0 ? tienNoKy / tienMuaKy : 0,
            soThangCoMua: thangCoMua,
            muaDau: dsKy.length ? vnYmd(dsKy[0]!.createdAt) : null,
            muaCuoi: dsKy.length ? vnYmd(dsKy[dsKy.length - 1]!.createdAt) : null,
        }

        const tongMuaAll = tatCa.reduce((s, t) => s + t.total, 0)
        const tongMua12 = ds12.reduce((s, t) => s + t.total, 0)
        const tiLeMuaChiuAll = tatCa.length ? tatCa.filter(t => t.coChiu).length / tatCa.length : 0
        const tiLeMuaChiu12 = ds12.length ? ds12.filter(t => t.coChiu).length / ds12.length : 0

        const hangNo = xepHangNo(duNo, fifo.ngayNoLauNhat, traGop, tatCa.length > 0)
        const diem = chamDiem({
            duNo, tongMua12, ngayNoLauNhat: fifo.ngayNoLauNhat,
            tangTruongTien: mr.xuHuong.tangTruongTien, dangImLau: mr.nhipMua.dangImLau,
            tiLeMuaChiu12, soDon12: ds12.length, xepHang: hangNo, traGop,
        })

        const lyDo: string[] = []
        if (traGop) lyDo.push(`Sổ không nợ nhưng còn ${fifo.soPhieuTreo} phiếu chưa gắn phiếu thu (${fifo.tienTreoTheoPhieu.toLocaleString('vi-VN')}đ theo phiếu) — khách trả gộp, KHÔNG phải nợ.`)
        if (!traGop && duNo > 0 && fifo.ngayNoLauNhat !== null && fifo.ngayNoLauNhat > 90) lyDo.push(`Nợ già nhất đã ${fifo.ngayNoLauNhat} ngày (quá 90) — rủi ro, nên thu trước khi bán chịu thêm.`)
        else if (!traGop && duNo > 0 && fifo.ngayNoLauNhat !== null && fifo.ngayNoLauNhat > 30) lyDo.push(`Nợ già nhất ${fifo.ngayNoLauNhat} ngày (quá 30) — nên theo dõi.`)
        if (!traGop && duNo > 0 && fifo.ngayNoLauNhat === null) lyDo.push('Nợ nằm NGOÀI phiếu (đầu kỳ nhập tay) — không xác định được tuổi nợ.')
        if (fifo.ngoaiPhieu > 0 && !traGop && fifo.ngayNoLauNhat !== null) lyDo.push(`${fifo.ngoaiPhieu.toLocaleString('vi-VN')}đ nợ ngoài phiếu (đầu kỳ hoặc ngoài hệ).`)
        if (mr.nhipMua.dangImLau) lyDo.push(`Khách im ${mr.nhipMua.ngayTuLanCuoi} ngày — dài hơn hẳn nhịp quen ${mr.nhipMua.tbNgayGiuaHaiLan} ngày/lần, nên hỏi thăm.`)
        if (mr.xuHuong.nhan === 'giam') lyDo.push(`Tiền mua 3 tháng gần giảm ${Math.abs(Math.round((mr.xuHuong.tangTruongTien ?? 0) * 100))}% so với 3 tháng trước.`)
        if (tatCa.length === 0 && duNo > 0) lyDo.push('Khách chưa có đơn nào trong hệ — dư nợ là số dư đầu kỳ.')

        res.json({
            success: true,
            data: {
                xepHang: hangNo,
                khach: { ten: kh.name, tongMua: Math.round(tongMuaAll), soDon: tatCa.length },
                lyDo,
                diem,
                duNo,
                soPhieuTreo: fifo.soPhieuTreo,
                tienTreoTheoPhieu: fifo.tienTreoTheoPhieu,
                phieuTreoKhongPhaiNo: traGop,
                phieuTreoGanNhat: traGop ? null : fifo.phieuTreoGanNhat,
                ngayNoGanNhat: traGop ? null : fifo.ngayNoGanNhat,
                ngayNoLauNhat: traGop ? null : fifo.ngayNoLauNhat,
                tiLeMuaChiu: tiLeMuaChiuAll,
                tongHopKy,
                soThangKy,
                moRong: {
                    nhipMua: mr.nhipMua,
                    xuHuong: mr.xuHuong,
                    doLonDon: mr.doLonDon,
                    noSauHon: {
                        noTrenTongMua: tongMuaAll > 0 ? duNo / tongMuaAll : (duNo > 0 ? 1 : 0),
                        noBangMayThangMua: tongHopKy.tbTienMuaThang > 0 && duNo > 0 ? lam1(duNo / tongHopKy.tbTienMuaThang) : null,
                        bacTuoi: fifo.bacTuoi,
                        ngoaiPhieu: fifo.ngoaiPhieu,
                    },
                },
                theoThang,
            },
        })
    } catch (err: any) {
        console.error('[financial-health]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không dựng được báo cáo' })
    }
})

export default router
