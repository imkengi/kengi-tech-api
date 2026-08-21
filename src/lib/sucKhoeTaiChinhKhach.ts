/**
 * HỒ SƠ SỨC KHOẺ TÀI CHÍNH CỦA KHÁCH — logic thuần, kiểm được.
 *
 * Yêu cầu chủ shop 18/08/2026:
 *   (2) "xem lại số ngày nợ của khách hàng, tính từ giao dịch không thanh toán
 *       cuối cùng"
 *   (3) "thêm mục hồ sơ sức khoẻ tài chính của khách hàng"
 *
 * QUY ƯỚC DỮ LIỆU (đừng đoán — lấy từ nơi GHI):
 *   - Bán chịu = Transaction.status 'partial' + Payment.type 'credit'.
 *   - Trả nợ   = Payment mới trên phiếu đó + DebtEntry.type 'payment'.
 *   - Số dư    = Customer.debt (mọi thay đổi đều ghi DebtEntry — xem
 *                debt-ledger-conventions).
 *
 * "SỐ NGÀY NỢ" — định nghĩa theo đúng lời chủ shop: tính từ GIAO DỊCH CHƯA
 * THANH TOÁN CŨ NHẤT còn treo? Hay CUỐI CÙNG? Chủ shop nói "cuối cùng" — tức
 * giao dịch chưa thanh toán GẦN NHẤT. Hai con số này khác nhau và cả hai đều có
 * ý nghĩa, nên trả cả hai:
 *   - ngayNoGanNhat : từ phiếu chưa trả hết GẦN NHẤT → "khách vừa mua chịu bao
 *                     lâu rồi" (đúng yêu cầu)
 *   - ngayNoLauNhat : từ phiếu chưa trả hết CŨ NHẤT còn treo → "khoản nợ già
 *                     nhất đã bao nhiêu ngày" (thứ kế toán gọi là tuổi nợ)
 *
 * ⚠ Ngày lấy theo `transactionDate` (ngày bán thật), rơi về `createdAt` — cửa
 * hàng nhập lịch sử từ KiotViet có createdAt = lúc nhập, lệch cả tháng.
 */

export interface PhieuNo {
    id: string
    total: number
    status: string
    transactionDate?: Date | string | null
    createdAt?: Date | string | null
    /** Số đã trả trên phiếu = Transaction.amountReceived (thước hệ thống dùng để chặn trả quá nợ). */
    daTra?: number | null
}

export interface HoSoSucKhoe {
    /** Số dư nợ hiện tại (lấy từ Customer.debt — nguồn sự thật). */
    duNo: number
    /** Số phiếu còn treo (chưa trả hết). */
    soPhieuTreo: number
    /** Tổng tiền còn treo tính từ phiếu (đối chiếu với duNo — lệch nhiều là dấu hiệu sổ lệch). */
    tienTreoTheoPhieu: number
    /** Ngày nợ tính từ phiếu chưa trả hết GẦN NHẤT (yêu cầu chủ shop). null = không nợ. */
    ngayNoGanNhat: number | null
    /** Ngày nợ tính từ phiếu chưa trả hết CŨ NHẤT còn treo (tuổi nợ). */
    ngayNoLauNhat: number | null
    /** Ngày của phiếu chưa trả hết gần nhất. */
    phieuTreoGanNhat: string | null
    /** Tỉ lệ mua chịu: số phiếu partial / tổng phiếu bán (0..1). */
    tiLeMuaChiu: number
    /**
     * Sổ (Customer.debt) và phiếu (Σ treo) lệch nhau ĐÁNG KỂ? MỘT nguồn quyết
     * định cho cả lyDo lẫn khối đối chiếu trên FE — FE KHÔNG được tự tính lại
     * ngưỡng, nếu không hai khối trên cùng một tab nói hai kiểu (bản FE đầu
     * 18/08 đã lệch đúng như vậy: BE đòi cả hai vế > 0, FE thì không).
     */
    soLechPhieu: boolean
    /**
     * Sổ nói KHÔNG nợ nhưng vẫn có phiếu chưa gắn phiếu thu — khách trả gộp /
     * phiếu thu chung (phổ biến ở cửa hàng đồng bộ KiotViet). Khi cờ này bật,
     * "ngày nợ" đã đặt null và "phiếu treo" chỉ nghĩa là "chưa gắn phiếu thu",
     * KHÔNG phải nợ. FE dùng cờ để đổi nhãn.
     */
    phieuTreoKhongPhaiNo: boolean
    /** Xếp hạng gợi ý — chỉ là GỢI Ý, chủ shop tự quyết. */
    xepHang: 'tot' | 'theo-doi' | 'rui-ro' | 'chua-du-du-lieu'
    /** Vì sao xếp hạng như vậy — nói thẳng, không bịa. */
    lyDo: string[]
}

/** Trạng thái phiếu được coi là ĐÃ BÁN — dùng chung cho mọi phép tính hồ sơ khách. */
export const TRANG_THAI_BAN = new Set(['completed', 'partial'])

/**
 * Sổ và phiếu lệch ĐÁNG KỂ = cả hai vế dương VÀ chênh > max(50k, 20% sổ).
 * Đòi cả hai vế dương là cố ý: sổ 0 mà phiếu treo còn (status chưa đổi) hay
 * ngược lại là chuyện cập nhật trạng thái, không phải "sổ lệch" cần đối chiếu.
 */
export function soLech(duNo: number, tienTreo: number): boolean {
    return duNo > 0 && tienTreo > 0 && Math.abs(duNo - tienTreo) > Math.max(50_000, duNo * 0.2)
}

export function ngayCua(p: PhieuNo): Date | null {
    const ng = p.transactionDate || p.createdAt
    if (!ng) return null
    const d = ng instanceof Date ? ng : new Date(ng)
    return isNaN(d.getTime()) ? null : d
}

/**
 * Tập phiếu ĐANG NỢ THẬT theo FIFO neo vào sổ: phiếu mới nhất cộng dồn ngược
 * cho tới khi phủ đủ `duNo`. Trả về Set id. `duNo <= 0` → rỗng.
 * Dùng chung cho tuổi nợ (tinhSucKhoeTaiChinh) và nợ phát sinh theo tháng
 * (gomTheoThang) — cùng một định nghĩa, hai chỗ không nói hai kiểu.
 */
export function tapPhieuNoThat(phieu: PhieuNo[], duNo: number): Set<string> {
    const ra = new Set<string>()
    let con = Math.max(0, duNo)
    if (con <= 0) return ra
    const treo = phieu
        .filter(p => String(p?.status) === 'partial')
        .map(p => ({ p, d: ngayCua(p), con: Math.max(0, (Number(p.total) || 0) - (Number(p.daTra) || 0)) }))
        .filter(x => x.d && x.con > 0)
        .sort((a, b) => b.d!.getTime() - a.d!.getTime())
    for (const x of treo) {
        if (con <= 0) break
        ra.add(x.p.id)
        con -= x.con
    }
    return ra
}

export function tinhSucKhoeTaiChinh(
    phieu: PhieuNo[],
    duNo: number,
    homNay: Date = new Date(),
): HoSoSucKhoe {
    const daBan = phieu.filter(p => TRANG_THAI_BAN.has(String(p?.status)))
    // Còn treo = partial và (nếu biết đã trả) chưa trả đủ
    const treo = daBan.filter(p =>
        String(p.status) === 'partial' && (p.daTra === undefined || p.daTra === null || Number(p.daTra) < Number(p.total)))

    // Tổng còn treo THEO PHIẾU (thô) — giữ để đối chiếu với sổ
    let tienTreo = 0
    for (const p of treo) tienTreo += Math.max(0, (Number(p.total) || 0) - (Number(p.daTra) || 0))

    /* TUỔI NỢ TÍNH THEO FIFO, NEO VÀO SỔ — không phải "phiếu treo cũ nhất".
     *
     * Ở cửa hàng đồng bộ KiotViet, khách trả GỘP / bằng phiếu thu CHUNG: sổ
     * (Customer.debt) giảm đúng, nhưng từng phiếu bán vẫn amountReceived=0 mãi.
     * Lấy phiếu treo cũ nhất làm "tuổi nợ" là buộc tội oan — Hiệp Hòa (HUTI,
     * 18/08/2026): sổ 126,6tr nhưng phiếu treo phồng hơn nhiều, phiếu cũ nhất
     * đã được trả gộp từ lâu.
     *
     * Kế toán chuẩn: tiền trả trước trừ vào phiếu CŨ trước (FIFO). Suy ra phần
     * nợ THẬT còn treo = các phiếu MỚI NHẤT cộng dồn ngược cho tới khi bằng số dư
     * sổ. Tuổi nợ = phiếu cũ nhất trong tập đó. Sổ 0 → tập rỗng → không có tuổi
     * nợ. Sổ lớn hơn cả tổng phiếu treo (nợ đầu kỳ nhập tay) → tập = toàn bộ
     * phiếu treo, và `soLechPhieu` sẽ nói phần còn lại nằm ngoài phiếu. */
    const noThat = tapPhieuNoThat(daBan, duNo)
    let ganNhat: Date | null = null, lauNhat: Date | null = null
    for (const p of treo) {
        if (!noThat.has(p.id)) continue
        const d = ngayCua(p)
        if (!d) continue
        if (!ganNhat || d > ganNhat) ganNhat = d
        if (!lauNhat || d < lauNhat) lauNhat = d
    }
    const ngay = (d: Date | null) => d ? Math.max(0, Math.floor((homNay.getTime() - d.getTime()) / 86_400_000)) : null

    const tiLe = daBan.length ? treo.length / daBan.length : 0
    const lyDo: string[] = []
    let xepHang: HoSoSucKhoe['xepHang']

    if (daBan.length === 0) {
        xepHang = 'chua-du-du-lieu'
        lyDo.push('Chưa có phiếu bán nào để đánh giá')
    } else if (duNo <= 0) {
        /* SỔ LÀ NGUỒN SỰ THẬT — sổ nói không nợ thì KHÔNG được ra "Rủi ro".
         *
         * Chủ shop bắt lỗi 18/08/2026 (Thiên Hưng, HUTI): sổ 0đ nhưng thẻ hiện
         * "Rủi ro — nợ già nhất 608 ngày, 31 phiếu treo 629 triệu". Khách này MUA
         * ĐÂU TRẢ ĐÓ, nhưng trả bằng phiếu thu CHUNG / trả gộp nhiều hoá đơn —
         * KiotViet ghi nhận đủ vào Customer.debt, còn từng phiếu bán vẫn giữ
         * amountReceived = 0 và status 'partial' mãi. 50 phiếu partial gần nhất
         * của HUTI thuộc 35 khách khác nhau — đây là cách vận hành phổ biến,
         * không phải ngoại lệ. "Phiếu treo" ở cửa hàng đó là dữ liệu PHỤ, không
         * được đè lên sổ. */
        xepHang = 'tot'
        lyDo.push(treo.length === 0
            ? 'Không còn khoản nợ nào treo'
            : `Sổ không ghi nợ; ${treo.length} phiếu chưa gắn phiếu thu (khách trả gộp / phiếu thu chung) — không tính là nợ`)
    } else {
        const nLau = ngay(lauNhat) ?? 0
        if (nLau > 90) { xepHang = 'rui-ro'; lyDo.push(`Khoản nợ già nhất đã ${nLau} ngày`) }
        else if (nLau > 30) { xepHang = 'theo-doi'; lyDo.push(`Khoản nợ già nhất đã ${nLau} ngày`) }
        else { xepHang = 'theo-doi'; lyDo.push(`Đang nợ ${treo.length} phiếu, mới nhất ${ngay(ganNhat) ?? 0} ngày`) }
        if (tiLe >= 0.5 && daBan.length >= 4) {
            lyDo.push(`Mua chịu ${Math.round(tiLe * 100)}% số phiếu`)
            if (xepHang === 'theo-doi' && nLau > 60) xepHang = 'rui-ro'
        }
        // Sổ với phiếu lệch xa nhau → nói ra, đừng im
        if (soLech(duNo, tienTreo)) {
            lyDo.push(`Số dư sổ ${Math.round(duNo).toLocaleString('vi-VN')}đ lệch với tổng phiếu treo ${Math.round(tienTreo).toLocaleString('vi-VN')}đ — nên đối chiếu`)
        }
    }

    /* Sổ 0 → "ngày nợ" KHÔNG có nghĩa (khách không nợ thì không có "tuổi nợ 608
     * ngày"). Đặt null thay vì để con số từ phiếu treo giả làm tuổi nợ. */
    const khongNo = duNo <= 0
    return {
        duNo: Math.round(duNo || 0),
        soPhieuTreo: treo.length,
        tienTreoTheoPhieu: Math.round(tienTreo),
        phieuTreoKhongPhaiNo: khongNo && treo.length > 0,
        soLechPhieu: soLech(duNo, tienTreo),
        ngayNoGanNhat: khongNo ? null : ngay(ganNhat),
        ngayNoLauNhat: khongNo ? null : ngay(lauNhat),
        phieuTreoGanNhat: ganNhat ? ganNhat.toISOString().slice(0, 10) : null,
        tiLeMuaChiu: Math.round(tiLe * 1000) / 1000,
        xepHang,
        lyDo,
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * BÁO CÁO THEO THÁNG — bổ sung 18/08/2026 theo yêu cầu chủ shop:
 * "chọn khách → báo cáo chi tiết: tỷ lệ đơn, 1 tháng mua bao nhiêu, tỷ lệ
 * nợ / mua trong vòng 1 tháng, ..."
 *
 * Tháng lấy theo GIỜ VIỆT NAM (+7) và theo NGÀY BÁN (transactionDate), rơi về
 * createdAt — cùng quy ước với phần trên. Cắt tháng theo UTC là đơn 23h30 đêm
 * cuối tháng rơi sang tháng sau.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ThangKhach {
    /** 'YYYY-MM' theo giờ VN */
    thang: string
    soDon: number
    tienMua: number
    /** Số phiếu bán chịu (partial) lập trong tháng */
    soDonChiu: number
    /** Tiền còn nợ của các phiếu lập trong tháng = Σ max(0, total − daTra) */
    tienNoPhatSinh: number
    /** tienNoPhatSinh / tienMua (0..1); tienMua = 0 → 0 */
    tiLeNoTrenMua: number
    /** soDonChiu / soDon (0..1) */
    tiLeDonChiu: number
}

export interface TongHopKyKhach {
    /** Số tháng có phát sinh (để tính trung bình có nghĩa) */
    soThangCoMua: number
    /** Trung bình tiền mua / tháng CÓ MUA (không chia cho tháng trống) */
    tbTienMuaThang: number
    tbSoDonThang: number
    /** Tổng nợ phát sinh trong kỳ / tổng mua trong kỳ */
    tiLeNoTrenMuaKy: number
    /** Ngày mua đầu và cuối trong kỳ (YYYY-MM-DD, giờ VN) */
    muaDau: string | null
    muaCuoi: string | null
}

const VN_OFFSET_MS = 7 * 3600_000

export function thangVN(d: Date): string {
    const v = new Date(d.getTime() + VN_OFFSET_MS)
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`
}
export function ngayVN(d: Date): string {
    return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Gom phiếu theo tháng (giờ VN). Chỉ tính phiếu 'completed'/'partial'.
 * @param soThang  số tháng gần nhất tính từ `homNay` (mặc định 12); 0 = tất cả
 */
/**
 * @param duNo  số dư sổ — truyền vào thì "nợ phát sinh" chỉ tính phiếu ĐANG NỢ
 *              THẬT theo FIFO (xem tapPhieuNoThat); không truyền (undefined) thì
 *              tính mọi phiếu partial như cũ. `soDonChiu` vẫn đếm mọi phiếu
 *              partial (đó là "đơn chưa gắn phiếu thu", con số mô tả, không buộc tội).
 */
export function gomTheoThang(phieu: PhieuNo[], homNay: Date = new Date(), soThang = 12, duNo?: number): { thang: ThangKhach[]; tongHop: TongHopKyKhach } {
    const daBan = phieu.filter(p => TRANG_THAI_BAN.has(String(p?.status)))
    const noThat = duNo === undefined ? null : tapPhieuNoThat(daBan, duNo)
    const bang = new Map<string, ThangKhach>()
    let muaDau: Date | null = null, muaCuoi: Date | null = null

    // Mốc cắt: đầu tháng thứ (soThang−1) trước tháng hiện tại, theo giờ VN
    let moc: Date | null = null
    if (soThang > 0) {
        const v = new Date(homNay.getTime() + VN_OFFSET_MS)
        const dau = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth() - (soThang - 1), 1))
        moc = new Date(dau.getTime() - VN_OFFSET_MS)
    }

    for (const p of daBan) {
        const d = ngayCua(p)
        if (!d) continue
        if (moc && d < moc) continue
        const k = thangVN(d)
        const t = bang.get(k) || { thang: k, soDon: 0, tienMua: 0, soDonChiu: 0, tienNoPhatSinh: 0, tiLeNoTrenMua: 0, tiLeDonChiu: 0 }
        t.soDon++
        t.tienMua += Number(p.total) || 0
        if (String(p.status) === 'partial') {
            t.soDonChiu++
            if (noThat === null || noThat.has(p.id)) {
                t.tienNoPhatSinh += Math.max(0, (Number(p.total) || 0) - (Number(p.daTra) || 0))
            }
        }
        bang.set(k, t)
        if (!muaDau || d < muaDau) muaDau = d
        if (!muaCuoi || d > muaCuoi) muaCuoi = d
    }

    const thang = [...bang.values()].sort((a, b) => a.thang.localeCompare(b.thang))
    for (const t of thang) {
        t.tienMua = Math.round(t.tienMua)
        t.tienNoPhatSinh = Math.round(t.tienNoPhatSinh)
        t.tiLeNoTrenMua = t.tienMua > 0 ? Math.round(t.tienNoPhatSinh / t.tienMua * 1000) / 1000 : 0
        t.tiLeDonChiu = t.soDon > 0 ? Math.round(t.soDonChiu / t.soDon * 1000) / 1000 : 0
    }
    const tongMua = thang.reduce((s, t) => s + t.tienMua, 0)
    const tongNo = thang.reduce((s, t) => s + t.tienNoPhatSinh, 0)
    const tongDon = thang.reduce((s, t) => s + t.soDon, 0)
    const n = thang.length
    return {
        thang,
        tongHop: {
            soThangCoMua: n,
            // Chia cho tháng CÓ MUA — chia cho 12 với khách mới mua 2 tháng là số ảo
            tbTienMuaThang: n ? Math.round(tongMua / n) : 0,
            tbSoDonThang: n ? Math.round(tongDon / n * 10) / 10 : 0,
            tiLeNoTrenMuaKy: tongMua > 0 ? Math.round(tongNo / tongMua * 1000) / 1000 : 0,
            muaDau: muaDau ? ngayVN(muaDau) : null,
            muaCuoi: muaCuoi ? ngayVN(muaCuoi) : null,
        },
    }
}
