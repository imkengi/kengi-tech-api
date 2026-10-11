// ═══════════════════════════════════════════════════════════════════════════════
//  SƠ ĐỒ MUA HÀNG CỦA MỘT KHÁCH (11/10/2026)
//
//  Chủ shop: "sơ đồ mua hàng là lịch sử mua hàng những sản phẩm gì á" → duyệt bản demo → "ok gắn dữ
//  liệu thật vào trang khách hàng đi, thêm nó thành 1 mục mới nha". MỘT lần gọi trả đủ cho tab
//  "Sơ đồ mua hàng" trong chi tiết khách: phiếu bán + từng món, trả hàng, bảo hành, dư nợ theo thời
//  gian, tuổi nợ, giá vốn + tồn kho hiện tại, gợi ý bán thêm so với khách cùng nhóm.
//
//  QUY ƯỚC ĐỌC (lấy từ nơi GHI, không đoán):
//    · Ngày bán = transactionDate ?? createdAt — cửa hàng nhập từ KiotViet có createdAt = lúc nhập.
//    · Phiếu của khách = customerId, hoặc phiếu CHƯA gắn customerId trùng tên / SĐT (y như debt-history).
//    · Bán chịu = status 'partial' / Payment 'credit'. Payment.type: cash | transfer | card | ewallet | credit.
//    · Dư nợ theo thời gian = sổ DebtEntry (debt +, payment −, return −) NEO vào Customer.debt. Đối chiếu
//      số dư không ghi sổ (debt-ledger-conventions) nên phần không giải thích được dồn vào "dư đầu kỳ".
//    · Lãi = giá bán thực (lineTotal / SL) − giá vốn HIỆN TẠI: phiếu bán không lưu giá vốn lúc bán ⇒ ƯỚC.
//    · anGiaVon: người xem không có quyền "Giá vốn"/"Lợi nhuận" ⇒ KHÔNG gửi giá vốn (von = null, anGiaVon = true).
//    · KHÔNG tính "trả trễ bao nhiêu ngày": chưa có nguồn "ngày trả đủ" đáng tin (lib/sucKhoeTaiChinhKhach).
//  CHỈ ĐỌC. Prod pool 1 kết nối ⇒ truy vấn TUẦN TỰ, không Promise.all.
// ═══════════════════════════════════════════════════════════════════════════════

import { tinhSucKhoeTaiChinh, tapPhieuNoThat, type PhieuNo } from './sucKhoeTaiChinhKhach'

const TRAN_PHIEU = 3000
const TRAN_NO = 3000
const KHOI = 500
const TRANG_THAI_DONG_SUA = new Set(['done', 'delivered', 'completed', 'returned', 'cancelled', 'canceled'])

export type CachTra = 'no' | 'ck' | 'mat' | 'the' | 'vi' | 'khac'

/** daXoa = hàng đã xoá khỏi danh mục: chỉ còn tên trên phiếu, không bán lại được ⇒ FE không đưa vào đơn gợi ý */
export interface SpSoDo { ten: string; sku: string; nhom: string; gia: number; von: number | null; ton: number | null; dv: string | null; daXoa?: boolean }
/** gia = giá thực (lineTotal / SL); giaGoc = đơn giá trên phiếu trước giảm giá dòng */
export interface DongDon { p: string; sl: number; gia: number; giaGoc: number; tien: number; giam: boolean }
export interface DonSoDo {
    id: string; ma: string; ngay: string; kenh: string; tt: CachTra; trangThai: string
    tong: number; giamDon: number; noTreo: boolean; hang: DongDon[]
}
export interface SuCoSoDo {
    loai: 'tra' | 'bh'; ma: string; ngay: string; p: string | null; ten: string | null; sl: number
    lyDo: string | null; trangThai: string; xong: string | null; dangSua: boolean
}
export interface SoDoMuaHang {
    homNay: string
    tu: string
    soThang: number
    khach: { id: string; ma: string; ten: string; sdt: string | null; nhom: string | null; no: number; tuoiNoLauNhat: number | null; tuoiNoGanNhat: number | null; soPhieuTreo: number; xepHang: string }
    sp: Record<string, SpSoDo>
    don: DonSoDo[]
    suCo: SuCoSoDo[]
    no: { hienTai: number; dauKy: number; dong: { ngay: string; loai: string; so: number; du: number; moTa: string }[]; chamTran: boolean }
    /** thangManh: các tháng bán mạnh (theo thứ tự mùa, vd [11, 12, 1]); rỗng = không theo mùa HOẶC ít số liệu —
     *  slNam (tổng SL mọi khách 12 tháng) để FE phân biệt hai trường hợp, không nói "bán đều" khi mới bán lèo tèo */
    /** true = người xem không có quyền xem giá vốn: mọi `von` là null VÌ ẨN, không phải vì thiếu số liệu */
    anGiaVon: boolean
    banThem: null | { soKhach: number; nhom: string | null; goiY: { p: string; ten: string; sku: string; ton: number | null; gia: number; so: number; thangManh: number[]; slNam: number }[]; loi?: string }
    chamTran: boolean
}

const ngayBan = (t: any): Date => new Date(t.transactionDate || t.createdAt)

/** Cách trả của một phiếu. Bán chịu thắng mọi thứ — phiếu ghi nợ rồi trả dần vẫn là "ghi nợ" lúc bán. */
export function cachTra(t: { status: string; payments?: { type: string }[] }): CachTra {
    const loai = new Set((t.payments || []).map(p => String(p.type)))
    if (t.status === 'partial' || loai.has('credit')) return 'no'
    if (loai.has('transfer')) return 'ck'
    if (loai.has('cash')) return 'mat'
    if (loai.has('card')) return 'the'
    if (loai.has('ewallet')) return 'vi'
    return 'khac'
}

/**
 * Tháng bán mạnh của một món từ SL bán theo tháng (mọi khách, 12 tháng): có MỘT cửa sổ 3 tháng LIỀN NHAU
 * (vòng qua năm: 11-12-1) chiếm ≥ 60% SL, và tổng ≥ 12 — ít hơn thì chưa đủ để nói mùa. Trả các tháng có bán
 * trong cửa sổ, theo thứ tự mùa.
 * Bản đầu (top 3 tháng ≥ 50%) cờ oan món bán đều: bán 6 tháng mỗi tháng như nhau thì 3 tháng bất kỳ đã 50%.
 */
export function thangBanManh(theoThang: { thang: number; sl: number }[]): number[] {
    const sl = new Array(13).fill(0)
    for (const r of theoThang) if (r.thang >= 1 && r.thang <= 12) sl[r.thang] += Math.max(0, Number(r.sl) || 0)
    const tong = sl.reduce((a, b) => a + b, 0)
    if (tong < 12) return []
    let tot = { bd: 0, sl: 0 }
    for (let bd = 1; bd <= 12; bd++) {
        const cua = [0, 1, 2].reduce((a, k) => a + sl[((bd - 1 + k) % 12) + 1], 0)
        if (cua > tot.sl) tot = { bd, sl: cua }
    }
    if (tot.sl / tong < 0.6) return []
    return [0, 1, 2].map(k => ((tot.bd - 1 + k) % 12) + 1).filter(m => sl[m] > 0)
}

/** Dấu của một dòng sổ công nợ: ghi nợ tăng, thu nợ / trả hàng giảm, điều chỉnh giữ dấu của số ghi. */
export function dauDongNo(loai: string): number {
    if (loai === 'debt' || loai === 'adjustment') return 1
    if (loai === 'payment' || loai === 'return') return -1
    return 0
}

export async function soDoMuaHang(prisma: any, khachId: string, opts: { soThang?: number; homNay?: Date; anGiaVon?: boolean } = {}): Promise<SoDoMuaHang | null> {
    const anGiaVon = !!opts.anGiaVon
    const homNay = opts.homNay ?? new Date()
    const soThang = Math.max(3, Math.min(36, Math.round(opts.soThang ?? 24)))
    const tu = new Date(homNay.getFullYear(), homNay.getMonth() - soThang + 1, 1)

    const kh = await prisma.customer.findUnique({
        where: { id: khachId },
        select: { id: true, code: true, name: true, phone: true, groupId: true, debt: true },
    })
    if (!kh) return null
    const nhomKhach = kh.groupId
        ? await prisma.customerGroup.findUnique({ where: { id: kh.groupId }, select: { name: true } }).catch(() => null)
        : null

    // ── 1. Phiếu bán của khách trong khoảng ──
    const cuaKhach: any[] = [{ customerId: kh.id }]
    if (kh.name) cuaKhach.push({ customerId: null, customerName: kh.name })
    if (kh.phone) cuaKhach.push({ customerId: null, customerPhone: kh.phone })
    const phieu: any[] = await prisma.transaction.findMany({
        where: {
            AND: [
                { OR: cuaKhach },
                { status: { in: ['completed', 'partial', 'returned'] } },
                { OR: [{ transactionDate: { gte: tu } }, { transactionDate: null, createdAt: { gte: tu } }] },
            ],
        },
        select: {
            id: true, receiptNumber: true, status: true, total: true, discount: true, amountReceived: true, channel: true,
            transactionDate: true, createdAt: true, returnedAt: true, returnReason: true,
            items: { select: { productId: true, productName: true, sku: true, quantity: true, unitPrice: true, discount: true, lineTotal: true } },
            payments: { select: { type: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: TRAN_PHIEU,
    })

    // ── 2. Sản phẩm — giá vốn, giá bán, tồn, nhóm hàng HIỆN TẠI ──
    const sp: Record<string, SpSoDo> = {}
    const dsMa = Array.from(new Set<string>(phieu.flatMap(t => (t.items || []).map((i: any) => String(i.productId)))))
    for (let i = 0; i < dsMa.length; i += KHOI) {
        const lo: any[] = await prisma.product.findMany({
            where: { id: { in: dsMa.slice(i, i + KHOI) } },
            select: { id: true, name: true, sku: true, costPrice: true, sellingPrice: true, stock: true, baseUnit: true, category: { select: { name: true } } },
        })
        for (const p of lo) {
            sp[p.id] = {
                ten: p.name, sku: p.sku, nhom: p.category?.name || 'Chưa phân nhóm',
                gia: Number(p.sellingPrice) || 0, von: anGiaVon || p.costPrice == null ? null : Number(p.costPrice),
                ton: p.stock == null ? null : Number(p.stock), dv: p.baseUnit || null,
            }
        }
    }
    // Hàng đã xoá khỏi danh mục: vẫn hiện theo tên trên phiếu, không bịa giá vốn / tồn
    for (const t of phieu) for (const i of t.items || []) {
        const ma = String(i.productId)
        if (!sp[ma]) sp[ma] = { ten: i.productName || ma, sku: i.sku || '', nhom: 'Chưa phân nhóm', gia: Number(i.unitPrice) || 0, von: null, ton: null, dv: null, daXoa: true }
    }

    // ── 3. Tuổi nợ + phiếu còn treo (đúng thước tab Sức khoẻ tài chính) ──
    const hienTai = Number(kh.debt) || 0
    const phieuNo: PhieuNo[] = phieu.filter(t => t.status === 'completed' || t.status === 'partial').map(t => ({
        id: t.id, total: Number(t.total) || 0, status: String(t.status),
        transactionDate: t.transactionDate, createdAt: t.createdAt, daTra: Number(t.amountReceived) || 0,
    }))
    const hoSo = tinhSucKhoeTaiChinh(phieuNo, hienTai, homNay)
    const treo = tapPhieuNoThat(phieuNo, hienTai)

    const don: DonSoDo[] = phieu.map(t => ({
        id: t.id, ma: t.receiptNumber, ngay: ngayBan(t).toISOString(), kenh: String(t.channel || 'direct'),
        tt: cachTra(t), trangThai: String(t.status), tong: Number(t.total) || 0, giamDon: Number(t.discount) || 0,
        noTreo: treo.has(t.id),
        hang: (t.items || []).map((i: any) => {
            const sl = Number(i.quantity) || 0
            const tien = Number(i.lineTotal) || 0
            const giaGoc = Number(i.unitPrice) || 0
            return { p: String(i.productId), sl, gia: sl ? Math.round(tien / sl) : giaGoc, giaGoc, tien, giam: Number(i.discount) > 0 }
        }).filter((h: DongDon) => h.sl > 0),
    })).filter(d => d.hang.length).sort((a, b) => a.ngay.localeCompare(b.ngay))

    // ── 4. Trả hàng: phiếu trả theo số phiếu bán của khách (trừ bị từ chối) + phiếu bán trả cả phiếu ──
    const suCo: SuCoSoDo[] = []
    const soPhieu = phieu.map(t => t.receiptNumber).filter(Boolean)
    const phieuDaCoPhieuTra = new Set<string>()
    for (let i = 0; i < soPhieu.length; i += KHOI) {
        const ds: any[] = await prisma.returnOrder.findMany({
            where: { originalInvoice: { in: soPhieu.slice(i, i + KHOI) }, status: { not: 'rejected' } },
            select: { code: true, originalInvoice: true, status: true, reason: true, createdAt: true, items: { select: { productId: true, productName: true, quantity: true, returnReason: true } } },
        })
        for (const r of ds) {
            phieuDaCoPhieuTra.add(r.originalInvoice)
            for (const it of r.items || []) {
                if (!(Number(it.quantity) > 0)) continue
                suCo.push({
                    loai: 'tra', ma: r.code, ngay: new Date(r.createdAt).toISOString(), p: it.productId || null, ten: it.productName || null,
                    sl: Number(it.quantity), lyDo: it.returnReason || r.reason || null, trangThai: String(r.status), xong: null, dangSua: false,
                })
            }
        }
    }
    for (const t of phieu) {
        if (t.status !== 'returned' || phieuDaCoPhieuTra.has(t.receiptNumber)) continue
        for (const i of t.items || []) {
            if (!(Number(i.quantity) > 0)) continue
            suCo.push({
                loai: 'tra', ma: t.receiptNumber, ngay: new Date(t.returnedAt || ngayBan(t)).toISOString(), p: String(i.productId), ten: i.productName || null,
                sl: Number(i.quantity), lyDo: t.returnReason || 'Trả cả phiếu', trangThai: 'returned', xong: null, dangSua: false,
            })
        }
    }

    // ── 5. Bảo hành / sửa chữa máy CỦA KHÁCH (không tính phiếu sửa hàng trong kho) ──
    const suaDieuKien: any[] = [{ customerId: kh.id }]
    if (kh.phone) suaDieuKien.push({ customerId: null, customerPhone: kh.phone })
    const sua: any[] = await prisma.repair.findMany({
        where: { AND: [{ OR: suaDieuKien }, { createdAt: { gte: tu } }, { source: { not: 'internal' } }] },
        select: { code: true, productId: true, productName: true, quantity: true, issue: true, status: true, createdAt: true, completedDate: true },
        orderBy: { createdAt: 'asc' },
        take: 500,
    }).catch(() => [])
    for (const r of sua) {
        const xong = r.completedDate ? new Date(r.completedDate).toISOString() : null
        suCo.push({
            loai: 'bh', ma: r.code, ngay: new Date(r.createdAt).toISOString(), p: r.productId || null, ten: r.productName || null,
            sl: Number(r.quantity) || 1, lyDo: r.issue || null, trangThai: String(r.status),
            xong, dangSua: !xong && !TRANG_THAI_DONG_SUA.has(String(r.status)),
        })
    }
    suCo.sort((a, b) => a.ngay.localeCompare(b.ngay))

    // ── 6. Dư nợ theo thời gian: sổ DebtEntry neo vào số nợ hiện tại ──
    const so: any[] = await prisma.debtEntry.findMany({
        where: { customerId: kh.id, createdAt: { gte: tu } },
        select: { type: true, amount: true, description: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: TRAN_NO,
    })
    const net = so.reduce((s, e) => s + dauDongNo(String(e.type)) * (Number(e.amount) || 0), 0)
    const dauKy = hienTai - net
    let du = dauKy
    const dongNo = so.map(e => {
        const soTien = dauDongNo(String(e.type)) * (Number(e.amount) || 0)
        du += soTien
        return { ngay: new Date(e.createdAt).toISOString(), loai: String(e.type), so: Math.round(soTien), du: Math.round(du), moTa: String(e.description || '').slice(0, 140) }
    })

    // ── 7. Bán thêm: khách CÙNG NHÓM (không có nhóm → mọi khách) mua trong 12 tháng, khách này chưa mua ──
    let banThem: SoDoMuaHang['banThem'] = null
    try {
        const tu12 = new Date(homNay.getTime() - 365 * 86400000)
        const nhomId = kh.groupId || null
        const dem: any[] = await prisma.$queryRawUnsafe(
            `WITH kh AS (
                 SELECT DISTINCT t."customerId" AS id
                   FROM "Transaction" t
                  WHERE t."customerId" IS NOT NULL AND t."customerId" <> $1
                    AND t."status" IN ('completed', 'partial')
                    AND COALESCE(t."transactionDate", t."createdAt") >= $2
                    AND ($3::text IS NULL OR t."customerId" IN (SELECT c."id" FROM "Customer" c WHERE c."groupId" = $3::text))
             )
             SELECT (SELECT COUNT(*) FROM kh)::int AS "soKhach", ti."productId" AS p, COUNT(DISTINCT t."customerId")::int AS so
               FROM "TransactionItem" ti
               JOIN "Transaction" t ON t."id" = ti."transactionId"
              WHERE t."customerId" IN (SELECT id FROM kh)
                AND t."status" IN ('completed', 'partial')
                AND COALESCE(t."transactionDate", t."createdAt") >= $2
              GROUP BY ti."productId"
              ORDER BY so DESC
              LIMIT 80`,
            kh.id, tu12, nhomId,
        )
        const soKhach = Number(dem[0]?.soKhach) || 0
        const daMua = new Set(dsMa)
        const nguong = Math.max(3, Math.ceil(soKhach * 0.1))
        const ung = dem.filter(r => !daMua.has(String(r.p)) && Number(r.so) >= nguong).slice(0, 4)
        const goiY: NonNullable<SoDoMuaHang['banThem']>['goiY'] = []
        if (ung.length) {
            const ma = ung.map(r => String(r.p))
            const thongTin: any[] = await prisma.product.findMany({
                where: { id: { in: ma } },
                select: { id: true, name: true, sku: true, stock: true, sellingPrice: true },
            })
            const theoMa = new Map(thongTin.map(p => [p.id, p]))
            // Tháng bán mạnh của từng món (mọi khách, 12 tháng) — để nói CHÀO LÚC NÀO, không đoán
            const giuCho = ma.map((_, i) => `$${i + 2}`).join(', ')
            const theoThang: any[] = await prisma.$queryRawUnsafe(
                `SELECT ti."productId" AS p, EXTRACT(MONTH FROM COALESCE(t."transactionDate", t."createdAt"))::int AS thang, SUM(ti."quantity")::int AS sl
                   FROM "TransactionItem" ti
                   JOIN "Transaction" t ON t."id" = ti."transactionId"
                  WHERE t."status" IN ('completed', 'partial')
                    AND COALESCE(t."transactionDate", t."createdAt") >= $1
                    AND ti."productId" IN (${giuCho})
                  GROUP BY 1, 2`,
                tu12, ...ma,
            )
            for (const r of ung) {
                const p = theoMa.get(String(r.p)); if (!p) continue
                const thang = theoThang.filter(x => String(x.p) === String(r.p)).map(x => ({ thang: Number(x.thang), sl: Number(x.sl) || 0 }))
                const slNam = thang.reduce((s, x) => s + x.sl, 0)
                goiY.push({ p: p.id, ten: p.name, sku: p.sku, ton: p.stock == null ? null : Number(p.stock), gia: Number(p.sellingPrice) || 0, so: Number(r.so), thangManh: thangBanManh(thang), slNam })
            }
        }
        banThem = { soKhach, nhom: nhomKhach?.name || null, goiY }
    } catch (e: any) {
        // Đọc hỏng ≠ "không có gì để bán thêm" — nói ra
        banThem = { soKhach: 0, nhom: nhomKhach?.name || null, goiY: [], loi: String(e?.message || e).slice(0, 200) }
    }

    return {
        homNay: homNay.toISOString(), tu: tu.toISOString(), soThang,
        khach: {
            id: kh.id, ma: kh.code, ten: kh.name, sdt: kh.phone || null, nhom: nhomKhach?.name || null, no: hienTai,
            // soPhieuTreo = tập FIFO neo vào sổ (đúng các phiếu viền đỏ trên sơ đồ). hoSo.soPhieuTreo là số phiếu
            // 'partial' THÔ — ở cửa hàng khách trả gộp nó phồng hàng chục phiếu đã trả xong (đo mẫu 11/10: 36 vs 3)
            tuoiNoLauNhat: hoSo.ngayNoLauNhat, tuoiNoGanNhat: hoSo.ngayNoGanNhat, soPhieuTreo: treo.size, xepHang: hoSo.xepHang,
        },
        sp, don, suCo,
        no: { hienTai, dauKy: Math.round(dauKy), dong: dongNo, chamTran: so.length >= TRAN_NO },
        anGiaVon,
        banThem,
        chamTran: phieu.length >= TRAN_PHIEU,
    }
}
