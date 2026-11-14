/**
 * PHÍ SÀN THẬT CỦA ĐƠN LAZADA (14/11/2026, chủ shop duyệt "lấy phí thật của đơn Lazada" — bước 1 trước Lazada Pilot).
 *
 * Nguồn: QueryTransactionDetails (LazadaService.docGiaoDichTaiChinh) — mỗi dòng là MỘT khoản tiền của MỘT dòng hàng.
 *
 * ĐO 14/11/2026 trên gian thật (KENGISTORE, đọc 20/03 → 14/11, ngày giao dịch thật 21/03 → 22/09: 493 dòng / 62 đơn —
 * /admin/lazada-phi-tho):
 *  - `amount` là CHUỖI có dấu phẩy nghìn ("-43,559.00"); paid_status "paid"; WHT_included_in_amount "No" (thuế là dòng RIÊNG).
 *  - Đơn giao bình thường: Item Price Credit (fee_type 13, dương) + các khoản âm: Commission (16), Payment Fee (3),
 *    Campaign Fee (515), Infrastructure Fee - Auto (5268, 3.000đ/đơn), LazCoins Discount (306), LazCoins Discount Promotion
 *    Fee (5028), LazCoins Discount-Affiliates Service Fee (5244), Withholding tax - VAT (5250, 1%) / PIT (5252, 0,5%).
 *    Không có dòng phí vận chuyển với đơn giao bình thường.
 *  - Item Price Credit = tổng tiền đơn trong Kengi (`total` = `price` của đơn Lazada) ở 41/41 đơn đối chiếu được.
 *  - Mọi dòng của một đơn ghi cùng MỘT ngày (61/62 đơn); đơn trả có thêm dòng "Refunds-*" về sau: Reversal Item Price
 *    (14, âm), hoàn Commission (15) / Campaign Fee (516) / LazCoins (307) / thuế (5251, 5253) / phí hạ tầng (5269) /
 *    Payment Fee Credit (4) — dương; Customer Return Delivery Fee (1128), Shipping Fee Voucher Refund to Laz (520) — âm.
 *  - Khoảng ngày hỏi Lazada tính CẢ HAI ĐẦU (tu = den = 08/09 ra đủ 7 dòng của ngày đó; 01/09 → 07/09 ra 0).
 *  - Phí (gồm thuế khấu trừ) trên 60 đơn giao: trung bình 26,7% tiền hàng (21,3% … 36,3%); không gồm thuế 25,2%.
 *
 * QUY ƯỚC — cùng nghĩa với Shopee escrow (shopee.ts getEscrowDetail) để mọi màn đọc platformFee / netRevenue như nhau:
 *  - thực nhận (netRevenue) = Σ MỌI dòng của đơn;
 *  - tiền hàng = Σ dòng 13 + 14 (Item Price Credit trừ Reversal Item Price);
 *  - phí sàn (platformFee) = tiền hàng − thực nhận: gộp trọn mọi khấu trừ, kể cả thuế sàn khấu trừ hộ (Shopee / TikTok Pilot
 *    cũng coi thuế nằm trong phí đo được). Đơn trả hết: tiền hàng 0 ⇒ phí = phần sàn giữ lại + phí ship hoàn, thực nhận ÂM
 *    = lỗ thật (đo: 159.500đ trả về ⇒ thực nhận −101.430đ), không giấu.
 *  - Thiếu số thì KHÔNG ghi (không ước tính): đơn chưa có dòng tiền hàng, dòng có số tiền không đọc được, phí tính ra âm,
 *    hay đọc Lazada chưa hết trang ⇒ để nguyên, báo lý do.
 * Đối soát KHÔNG sinh bút toán (giống Shopee / TikTok: phí ghi nhận theo hoá đơn GTGT cuối kỳ).
 */
import { SQL_GHI_LAY_DUOC } from './phiSanGiuLai'

export interface DongGiaoDichLazada {
    order_no?: unknown
    orderItem_no?: unknown
    amount?: unknown
    fee_type?: unknown
    fee_name?: unknown
    transaction_type?: unknown
    transaction_date?: unknown
}

/** "-43,559.00" → -43559. Rỗng / không phải số ⇒ null — KHÔNG coi là 0. */
export function soTienLazada(v: unknown): number | null {
    if (v === null || v === undefined) return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    const s = String(v).trim().replace(/,/g, '')
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null
    return Number(s)
}

/** Dòng TIỀN HÀNG: Item Price Credit (13) và Reversal Item Price (14). Nhận theo mã HOẶC tên (đo 14/11/2026). */
export function laDongTienHang(d: DongGiaoDichLazada): boolean {
    const ma = String(d?.fee_type ?? '').trim()
    const ten = String(d?.fee_name ?? '').trim().toLowerCase()
    return ma === '13' || ma === '14' || ten === 'item price credit' || ten === 'reversal item price'
}

/** Dòng GHI CÓ tiền hàng (Item Price Credit) — có nó mới là đơn Lazada đã quyết toán. */
export function laGhiCoTienHang(d: DongGiaoDichLazada): boolean {
    return String(d?.fee_type ?? '').trim() === '13' || String(d?.fee_name ?? '').trim().toLowerCase() === 'item price credit'
}

export interface GomDonLazada {
    maDon: string
    soDong: number
    tienHang: number
    thucNhan: number
    coGhiCoTienHang: boolean
    /** số dòng có `amount` không đọc được — có thì KHÔNG ghi đơn đó */
    amountHong: number
    ngay: string[]
}

/** Gom dòng theo order_no. Dòng không có order_no (nạp quảng cáo, phí cả gian…) không phải phí của đơn nào ⇒ bỏ. */
export function gomTheoDonLazada(dong: DongGiaoDichLazada[]): Map<string, GomDonLazada> {
    const m = new Map<string, GomDonLazada>()
    for (const d of dong || []) {
        const ma = String(d?.order_no ?? '').trim()
        if (!ma) continue
        const g = m.get(ma) || { maDon: ma, soDong: 0, tienHang: 0, thucNhan: 0, coGhiCoTienHang: false, amountHong: 0, ngay: [] }
        g.soDong++
        const a = soTienLazada(d?.amount)
        if (a === null) g.amountHong++
        else {
            g.thucNhan += a
            if (laDongTienHang(d)) g.tienHang += a
        }
        if (laGhiCoTienHang(d)) g.coGhiCoTienHang = true
        const n = String(d?.transaction_date ?? '').trim()
        if (n && !g.ngay.includes(n)) g.ngay.push(n)
        m.set(ma, g)
    }
    for (const g of m.values()) { g.tienHang = Math.round(g.tienHang); g.thucNhan = Math.round(g.thucNhan) }
    return m
}

export type SoPhiLazada = { platformFee: number; netRevenue: number } | { boQua: string; chuaQuyetToan?: true }

/** Số phí của MỘT đơn từ phần đã gom — hoặc lý do KHÔNG ghi. */
export function soPhiTuGom(g: GomDonLazada | undefined): SoPhiLazada {
    if (!g) return { boQua: 'Lazada chưa có giao dịch nào của đơn này (chưa quyết toán)', chuaQuyetToan: true }
    if (g.amountHong > 0) return { boQua: `${g.amountHong} dòng có số tiền không đọc được — không ghi nửa số` }
    if (!g.coGhiCoTienHang) return { boQua: 'chưa thấy dòng tiền hàng (Item Price Credit) — thiếu dòng hoặc khoảng ngày chưa phủ' }
    const phi = g.tienHang - g.thucNhan
    if (phi < 0) return { boQua: `phí tính ra ÂM (${phi}) — thiếu dòng phí?` }
    return { platformFee: phi, netRevenue: g.thucNhan }
}

const MOT_NGAY = 86400_000
const isoNgay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** Ngày theo giờ Việt Nam (UTC+7) — ngày giao dịch Lazada VN. */
export const ngayVN = (d: Date | number) => isoNgay((typeof d === 'number' ? d : d.getTime()) + 7 * 3600_000)

/** Chia [tu, den] (YYYY-MM-DD, tính cả hai đầu) thành các khoảng KHÔNG chồng nhau, mỗi khoảng den − tu ≤ toiDa ngày. */
export function chiaKhoangNgay(tu: string, den: string, toiDa = 179): Array<{ tu: string; den: string }> {
    const a0 = Date.parse(`${tu}T00:00:00Z`), b = Date.parse(`${den}T00:00:00Z`)
    if (!Number.isFinite(a0) || !Number.isFinite(b) || a0 > b) return []
    const ra: Array<{ tu: string; den: string }> = []
    for (let a = a0; a <= b;) {
        const c = Math.min(a + toiDa * MOT_NGAY, b)
        ra.push({ tu: isoNgay(a), den: isoNgay(c) })
        a = c + MOT_NGAY
    }
    return ra
}

export interface DichVuLazadaTaiChinh {
    docGiaoDichTaiChinh(o: { tu: string; den: string }): Promise<{ dong: any[]; catTai?: string }>
}

/** Đọc mọi dòng giao dịch trong [tu, den] qua nhiều khoảng ≤ 179 ngày. `catTai` gom lại khi khoảng nào chưa đọc hết. */
export async function docGiaoDichNhieuKhoang(svc: DichVuLazadaTaiChinh, tu: string, den: string): Promise<{ dong: any[]; catTai?: string }> {
    const dong: any[] = []
    const cat: string[] = []
    for (const k of chiaKhoangNgay(tu, den)) {
        const r = await svc.docGiaoDichTaiChinh({ tu: k.tu, den: k.den })
        dong.push(...(r?.dong || []))
        if (r?.catTai) cat.push(`${k.tu} → ${k.den}: ${r.catTai}`)
    }
    return { dong, ...(cat.length ? { catTai: cat.join('; ') } : {}) }
}

export interface BaoCaoDoiSoatLazada {
    apply: boolean
    khoang: { tu: string; den: string } | null
    soDongLazada: number
    soDonLazada: number
    /** đơn Kengi đem soát (không tính đơn huỷ) */
    quet: number
    /** đơn có số khác số đang lưu — sẽ ghi (chạy thử) / đã ghi (apply) */
    seGhi: number
    daGhi: number
    giongNhau: number
    /** Lazada chưa có giao dịch của đơn (chưa quyết toán) */
    chuaCo: number
    /** có giao dịch mà KHÔNG ghi được — kèm lý do */
    boQua: Array<{ orderNumber: string; lyDo: string }>
    /** id đơn vừa từ "chưa có số" (phí 0, thực nhận 0) sang có số — chỗ gọi quyết có cảnh báo lãi thấp hay không */
    vuaCoPhi: string[]
    /** cộng trên các đơn có số (sau đối soát). tyLePhi (%) chỉ tính đơn còn tiền hàng — đơn trả hết (tiền hàng 0, phí > 0)
     *  không kéo tỷ lệ lên vô nghĩa */
    tong: { tienHang: number; phi: number; thucNhan: number; tyLePhi: number | null }
    /** phiếu ONLINE-LZD- mất đơn gốc (cron dọn đã xoá) — số ghi vào PhiSanDon */
    phieuMatGoc: { quet: number; seGhi: number; daGhi: number; giongNhau: number; chuaCo: number } | null
    /** order_no có giao dịch trong khoảng đọc mà không thuộc đơn / phiếu nào đem soát (đơn trước khi nối kênh, đơn huỷ, đơn cũ
     *  hơn mốc soát…) — chỉ đếm, không ghi */
    ngoaiDotSoat: number
    mau: Array<{ orderNumber: string; cu: { phi: number; thuc: number }; moi: { phi: number; thuc: number } }>
    loi?: string
}

export interface TuyChonDoiSoatLazada {
    apply: boolean
    /** chỉ soát đơn TẠO từ mốc này (cron: 90 ngày; nút kênh: N ngày ≤ 90); bỏ trống = mọi đơn */
    tuNgayTao?: Date
    /** cả phiếu ONLINE-LZD- mất đơn gốc ⇒ PhiSanDon (chỉ lượt kéo bù của admin) */
    phieuMatGoc?: boolean
    bayGio?: Date
}

const TRANG_THAI_KHONG_SOAT = ['cancelled', 'CANCELLED', 'UNPAID']

/**
 * ĐỐI SOÁT PHÍ Lazada cho MỘT kênh: đọc giao dịch từ ngày đơn cũ nhất tới hôm nay (một lượt đọc cho cả kênh, không hỏi
 * từng đơn), gom theo đơn, so với số đang lưu. Không `apply` ⇒ CHẠY THỬ: chỉ đếm, KHÔNG ghi gì.
 * `apply` ⇒ ghi platformFee + netRevenue cho đơn có số KHÁC số đang lưu (sửa được cả đơn đã có số — đơn trả về sau thêm dòng
 * hoàn), tuần tự từng đơn (pool prod = 1). Đơn chưa có số / không ghi được ⇒ để nguyên. KHÔNG gọi cảnh báo lãi thấp —
 * trả `vuaCoPhi` để chỗ gọi quyết (cron có, kéo bù đơn cũ thì không).
 */
export async function doiSoatPhiLazada(db: any, ch: { id: string }, svc: DichVuLazadaTaiChinh, o: TuyChonDoiSoatLazada): Promise<BaoCaoDoiSoatLazada> {
    const bayGio = o.bayGio || new Date()
    const bc: BaoCaoDoiSoatLazada = {
        apply: o.apply, khoang: null, soDongLazada: 0, soDonLazada: 0, quet: 0, seGhi: 0, daGhi: 0, giongNhau: 0, chuaCo: 0,
        boQua: [], vuaCoPhi: [], tong: { tienHang: 0, phi: 0, thucNhan: 0, tyLePhi: null }, phieuMatGoc: null,
        ngoaiDotSoat: 0, mau: [],
    }
    const don: any[] = await db.onlineOrder.findMany({
        where: {
            channelId: ch.id, status: { notIn: TRANG_THAI_KHONG_SOAT }, externalOrderId: { not: null },
            ...(o.tuNgayTao ? { createdAt: { gte: o.tuNgayTao } } : {}),
        },
        select: { id: true, externalOrderId: true, orderNumber: true, platformFee: true, netRevenue: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
    })
    bc.quet = don.length

    // Phiếu mất đơn gốc — cùng điều kiện với lấy lại phí Shopee / TikTok (phiSanGiuLai.sqlDonMatGoc): phiếu chưa đảo / trả
    let phieu: Array<{ orderNumber: string; ngay: Date; phiGiu: number | null; thucGiu: number | null }> = []
    if (o.phieuMatGoc) {
        const rows: any[] = await db.$queryRawUnsafe(`
            SELECT substring(t."receiptNumber" from 8) AS "orderNumber", COALESCE(t."transactionDate", t."createdAt") AS ngay,
                   f."platformFee" AS "phiGiu", f."netRevenue" AS "thucGiu"
            FROM "Transaction" t
            LEFT JOIN "OnlineOrder" o ON o."orderNumber" = substring(t."receiptNumber" from 8)
            LEFT JOIN "PhiSanDon" f ON f."orderNumber" = substring(t."receiptNumber" from 8)
            WHERE t."receiptNumber" LIKE 'ONLINE-LZD-%' AND t.status NOT IN ('voided', 'returned') AND o.id IS NULL`)
        phieu = rows.map(r => ({
            orderNumber: String(r.orderNumber), ngay: new Date(r.ngay),
            phiGiu: r.phiGiu == null ? null : Number(r.phiGiu), thucGiu: r.thucGiu == null ? null : Number(r.thucGiu),
        }))
        bc.phieuMatGoc = { quet: phieu.length, seGhi: 0, daGhi: 0, giongNhau: 0, chuaCo: 0 }
    }
    if (!don.length && !phieu.length) return bc

    // Một lượt đọc cho cả kênh: từ ngày (giờ VN) của đơn / phiếu cũ nhất − 1 ngày tới hôm nay
    const moc = Math.min(...don.map(d => new Date(d.createdAt).getTime()), ...phieu.map(p => p.ngay.getTime()))
    const tu = ngayVN(moc - MOT_NGAY), den = ngayVN(bayGio)
    bc.khoang = { tu, den }
    const doc = await docGiaoDichNhieuKhoang(svc, tu, den)
    bc.soDongLazada = doc.dong.length
    if (doc.catTai) {
        // Đọc chưa hết thì không biết đơn nào thiếu dòng — KHÔNG ghi đơn nào
        bc.loi = `Đọc giao dịch Lazada chưa hết (${doc.catTai}) — không ghi gì lượt này`
        return bc
    }
    const gom = gomTheoDonLazada(doc.dong)
    bc.soDonLazada = gom.size

    const daDung = new Set<string>()
    let phiDonBan = 0, tienDonBan = 0
    for (const d of don) {
        const ma = String(d.externalOrderId || '').trim()
        daDung.add(ma)
        const so = soPhiTuGom(gom.get(ma))
        if ('boQua' in so) {
            if (so.chuaQuyetToan) bc.chuaCo++
            else bc.boQua.push({ orderNumber: String(d.orderNumber), lyDo: so.boQua })
            continue
        }
        const tienHang = gom.get(ma)!.tienHang
        bc.tong.tienHang += tienHang
        bc.tong.phi += so.platformFee
        bc.tong.thucNhan += so.netRevenue
        if (tienHang > 0) { tienDonBan += tienHang; phiDonBan += so.platformFee }
        const cuPhi = Number(d.platformFee) || 0, cuThuc = Number(d.netRevenue) || 0
        if (Math.abs(cuPhi - so.platformFee) < 1 && Math.abs(cuThuc - so.netRevenue) < 1) { bc.giongNhau++; continue }
        bc.seGhi++
        if (bc.mau.length < 10) bc.mau.push({ orderNumber: String(d.orderNumber), cu: { phi: cuPhi, thuc: cuThuc }, moi: { phi: so.platformFee, thuc: so.netRevenue } })
        if (!o.apply) continue
        await db.onlineOrder.update({ where: { id: d.id }, data: { platformFee: so.platformFee, netRevenue: so.netRevenue } })
        bc.daGhi++
        if (cuPhi === 0 && cuThuc === 0 && (so.platformFee !== 0 || so.netRevenue !== 0)) bc.vuaCoPhi.push(d.id)
    }

    if (bc.phieuMatGoc) {
        const ghi: { ma: string[]; san: string[]; phi: number[]; thuc: number[]; kenh: string[] } = { ma: [], san: [], phi: [], thuc: [], kenh: [] }
        for (const p of phieu) {
            const ma = p.orderNumber.replace(/^LZD-/i, '')
            daDung.add(ma)
            const so = soPhiTuGom(gom.get(ma))
            if ('boQua' in so) {
                if (so.chuaQuyetToan) bc.phieuMatGoc.chuaCo++
                else bc.boQua.push({ orderNumber: p.orderNumber, lyDo: `(phiếu mất đơn gốc) ${so.boQua}` })
                continue
            }
            // PhiSanDon đã có số thật thì không đè (cùng luật SQL_GHI_LAY_DUOC: chỉ ghi khi netRevenue đang 0)
            if (p.thucGiu !== null && p.thucGiu !== 0) {
                if (Math.abs((p.phiGiu || 0) - so.platformFee) < 1 && Math.abs(p.thucGiu - so.netRevenue) < 1) bc.phieuMatGoc.giongNhau++
                else bc.boQua.push({ orderNumber: p.orderNumber, lyDo: `(phiếu mất đơn gốc) số giữ lại ${p.phiGiu}/${p.thucGiu} khác Lazada ${so.platformFee}/${so.netRevenue} — không đè` })
                continue
            }
            if (so.netRevenue === 0) { bc.phieuMatGoc.giongNhau++; continue }   // đơn trả hết: 0 = "chưa có số" trong PhiSanDon
            bc.phieuMatGoc.seGhi++
            ghi.ma.push(p.orderNumber); ghi.san.push('lazada'); ghi.phi.push(so.platformFee); ghi.thuc.push(so.netRevenue); ghi.kenh.push(ch.id)
        }
        if (o.apply && ghi.ma.length) {
            await db.$executeRawUnsafe(SQL_GHI_LAY_DUOC, ghi.ma, ghi.san, ghi.phi, ghi.thuc, ghi.kenh)
            bc.phieuMatGoc.daGhi = ghi.ma.length
        }
    }

    for (const ma of gom.keys()) if (!daDung.has(ma)) bc.ngoaiDotSoat++
    bc.tong.tyLePhi = tienDonBan > 0 ? Math.round(phiDonBan / tienDonBan * 10000) / 100 : null
    return bc
}
