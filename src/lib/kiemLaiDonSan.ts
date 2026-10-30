/**
 * KIỂM LẠI ĐƠN SÀN — soát từng đơn qua CẢ VÒNG ĐỜI (29/10/2026)
 *
 * Chủ shop: "đơn online t cảm giác khi chỉ đẩy đơn xong thì nó sẽ vẫn còn sai sót, hay thêm chế độ doublecheck để kiểm tra xem
 * đã đúng hay chưa". Hỏi lại thì "đẩy đơn" là cả chuỗi việc: "ghi nhận đơn đó, xong nhận phí nè, rồi xuất hoá đơn nè, rồi sẽ
 * cập nhật trả hàng nè, nó sẽ có nhiều công việc cho đến khi hoàn thành á".
 *
 * Mỗi đơn sàn đi qua 5 bước, mỗi bước một ô:
 *   1. GHI NHẬN  — đơn đã bán phải có phiếu bán ONLINE-<mã đơn> (services/orderSync); dòng hàng sàn chưa nối hàng kho bị bỏ khỏi
 *                  phiếu (orderSync ghi "⚠ N dòng chưa nối được hàng kho" vào notes); tổng phiếu = tổng đơn; phiếu đã vào sổ
 *                  (bút toán SALE-<phiếu>, chỉ soát cửa hàng ghi sổ kép — cùng luật lib/viecCanLam mục 13).
 *   2. PHÍ SÀN   — số phí / thực nhận THẬT từ escrow Shopee hoặc statement TikTok (cron runFeeSync); đơn đã bị cron dọn thì đọc
 *                  bảng PhiSanDon. Không có số thật thì nói "chưa có", KHÔNG ước tính (chủ shop 06/09/2026). Lazada chưa có API phí.
 *   3. HOÁ ĐƠN   — cửa hàng dùng HĐĐT: đơn đã giao phải có HĐ đang hiệu lực, tiền HĐ = tiền phiếu, khách khai MST trên sàn thì HĐ
 *                  phải mang đúng MST; HĐ lỗi / chưa xuất thì chỉ đường. Mới giao trong 36 giờ thì còn chờ hàng đợi 20:30.
 *   4. TRẢ HÀNG  — có vụ trả: hoàn tiền rồi ⇒ phiếu phải đã đảo (voided, services/onlineOrderReversal), HĐ đã xuất phải có bản
 *                  điều chỉnh / thay thế; sàn báo trả mà chưa có phiếu trả ⇒ đồng bộ trả hàng. Không trả ⇒ ô "—".
 *   5. HOÀN TẤT  — không còn bước nào lỗi, chờ hay thiếu dữ liệu.
 *
 * Trạng thái ô: ok (đúng) · loi (sai/thiếu, có việc phải làm — kèm `hanhDong`) · cho (chưa tới lúc) · bo_qua (không áp dụng) ·
 * khong_ro (không đọc được dữ liệu — KHÔNG kết luận, "không đọc được" ≠ "không có").
 *
 * Đơn hoàn tất quá 18 ngày bị cron dọn xoá (autoSync runCleanup); phiếu, HĐ, phiếu trả, PhiSanDon còn ⇒ dòng dựng từ phiếu, đánh
 * dấu `daDon`, không còn trạng thái sàn để so. Hàm thuần `soatMotDon` (bộ kiểm scripts/check-kiem-lai-don-san.ts); hàm nạp
 * `kiemLaiDonSan` hỏi CSDL theo lô 500 (pool prod = 1, tuần tự).
 */

import { TRANG_THAI_DUOC_LEN_PHIEU, TRANG_THAI_CHO_XAC_NHAN } from './donDuocXoa'

export type TrangThaiBuoc = 'ok' | 'loi' | 'cho' | 'bo_qua' | 'khong_ro'
export interface Buoc { tt: TrangThaiBuoc; ghiChu: string; hanhDong?: string }

export interface DonKiem {
    id?: string; orderNumber: string; platform?: string | null; channelId?: string | null; channelName?: string | null
    status: string; total: number; createdAt?: Date | string | null; deliveredAt?: Date | string | null; customerName?: string | null
    platformFee?: number | null; platformFeeRate?: number | null; netRevenue?: number | null; khongKhopSku?: boolean | null
}
export interface PhieuKiem {
    id: string; receiptNumber: string; status: string; total: number; notes?: string | null; vatBuyerInfo?: string | null
    transactionDate?: Date | string | null; createdAt?: Date | string | null
}
export interface HoaDonKiem {
    id: string; transactionId?: string | null; status: string; invoiceType?: string | null; invoiceNumber?: string | null; invoiceDate?: Date | string | null
    totalAmount?: number | null; buyerTaxCode?: string | null; replacedByInvoiceId?: string | null; adjustedByInvoiceId?: string | null
    errorMessage?: string | null; createdAt?: Date | string | null
}
export interface TraHangKiem { code: string; status: string; originalInvoice?: string | null; refundAmount?: number | null; totalRefund?: number | null }
export interface PhiGiuKiem { platformFee: number; netRevenue: number; nguon: string }

export interface DuLieuMotDon {
    don: DonKiem | null
    phieu: PhieuKiem | null
    /** Σ lineTotal + số dòng của phiếu; null = chưa đếm */
    tongDong?: { tong: number; soDong: number } | null
    /** có bút toán SALE-<phiếu>? null = không soát (tắt ghi sổ / hộ kinh doanh) hoặc không đọc được */
    coSoSale?: boolean | null
    /** null = không đọc được bảng hoá đơn */
    hoaDons?: HoaDonKiem[] | null
    traHangs?: TraHangKiem[]
    /** PhiSanDon của đơn đã dọn: dòng | null (không có) | undefined (không đọc được bảng) */
    phiGiu?: PhiGiuKiem | null | undefined
}
export interface CauHinhKiem {
    dungHoaDonDienTu: boolean   // cửa hàng có EInvoiceConfig đang bật
    tuXuat: boolean             // hàng đợi 20:30 tự xuất mọi đơn giao xong (EInvoiceConfig.extra.autoIssueOnDelivery)
    soatSo: boolean             // soát bút toán SALE (ghi sổ tự động bật + không phải hộ KD)
}

export interface DongKiemLai {
    id: string | null; orderNumber: string; platform: string; channelId: string | null; channelName: string | null
    status: string | null; createdAt: string | null; deliveredAt: string | null; total: number; customerName: string | null
    daDon: boolean; receiptNumber: string | null; soHoaDon: string | null; phiSan: number | null; thucNhan: number | null
    phieu: Buoc; phi: Buoc; hoaDon: Buoc; traHang: Buoc; hoanTat: Buoc
    /** ghi chú các ô lỗi — để lọc "chỉ đơn có vấn đề" và hiện cột Vấn đề */
    vanDe: string[]
}
export interface DemBuoc { ok: number; loi: number; cho: number; bo_qua: number; khong_ro: number }
export interface KetQuaKiemLai {
    tu: string; den: string; cauHinh: CauHinhKiem
    tongQuan: { soDon: number; daDon: number; hoanTat: number; coVanDe: number; dangCho: number; chamTran: boolean; theoBuoc: Record<'phieu' | 'phi' | 'hoaDon' | 'traHang' | 'hoanTat', DemBuoc> }
    ds: DongKiemLai[]
}

const HUY = new Set(['cancelled', 'CANCELLED', 'UNPAID'])
const DA_GIAO = new Set(['delivered', 'DELIVERED', 'completed', 'COMPLETED'])
const SAN_BAO_TRA = new Set(['TO_RETURN', 'RETURN', 'returned', 'RETURNED', 'refunded', 'REFUNDED', 'refund'])
const CHO_XAC_NHAN = new Set<string>(TRANG_THAI_CHO_XAC_NHAN)
const LEN_PHIEU = new Set<string>(TRANG_THAI_DUOC_LEN_PHIEU)
/** HĐ đang có giá trị (cùng tập routes/einvoice: ISSUING/issued cũ + SIGNED/SENT) */
const HD_HIEU_LUC = new Set(['SENT', 'issued', 'SIGNED', 'ISSUING'])
const TRA_UU_TIEN: Record<string, number> = { refunded: 5, approved: 4, processing: 3, pending: 2, exchanged: 1, rejected: 0 }
/** Mới giao trong chừng này giờ thì HĐ chưa xuất là CHỜ hàng đợi 20:30, chưa phải lỗi */
export const GIO_CHO_HANG_DOI = 36
const TRAN = 5000
const LO = 500

export const dinhTien = (n: any) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`
const time = (d: any) => { const t = d ? new Date(d).getTime() : NaN; return Number.isFinite(t) ? t : 0 }
const iso = (d: any) => (d ? new Date(d).toISOString() : null)
/** dd/mm/yyyy theo NGÀY VN. Prisma trả cột DateTime là Date — String(Date) ra "Fri Oct 09 2026 …" nên đổi sang giờ VN rồi mới cắt */
const ddmm = (s: Date | string) => {
    const t = s instanceof Date || /T\d{2}:/.test(String(s)) ? time(s) : 0
    const chu = t ? new Date(t + 7 * 3600_000).toISOString() : String(s)
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(chu)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : chu
}

/** Nền tảng từ đơn, hoặc từ tiền tố mã đơn khi đơn đã bị dọn (SPE/TIK/LZD — cùng quy ước routes/yeuCauHoaDon) */
export function nenTangCuaMa(don: DonKiem | null, orderNumber: string): string {
    const p = String(don?.platform || '').toLowerCase()
    if (p) return p
    if (/^SPE-/i.test(orderNumber)) return 'shopee'
    if (/^TIK-/i.test(orderNumber)) return 'tiktok'
    if (/^LZD-/i.test(orderNumber)) return 'lazada'
    return ''
}

/** Cùng luật `daQuyetToanSql` (lib/phiSanGiuLai): netRevenue ≠ 0 (ÂM vẫn là số thật) và phí không mang hình dạng ước tính total × rate */
export function phiDaQuyetToan(o: { total: number; platformFee?: number | null; platformFeeRate?: number | null; netRevenue?: number | null }): boolean {
    const net = Number(o.netRevenue) || 0
    if (net === 0) return false
    const rate = Number(o.platformFeeRate) || 0
    if (rate > 0 && Math.abs((Number(o.platformFee) || 0) - Math.round((Number(o.total) || 0) * rate / 100)) <= 1) return false
    return true
}

/** MST khách khai trên phiếu (Transaction.vatBuyerInfo JSON) — bỏ khoảng trắng; hỏng dạng ⇒ null */
export function mstKhachKhai(vatBuyerInfo: string | null | undefined): string | null {
    if (!vatBuyerInfo) return null
    try { const v = JSON.parse(vatBuyerInfo); const m = String(v?.taxCode || '').replace(/\s+/g, ''); return m || null } catch { return null }
}

/** Số dòng chưa nối hàng kho mà orderSync ghi vào notes ("⚠ 2 dòng chưa nối được hàng kho…") — 0 = không có */
export const dongChuaNoi = (notes: string | null | undefined): number => {
    const m = /(\d+)\s*dòng chưa nối/i.exec(String(notes || ''))
    return m ? Number(m[1]) || 0 : 0
}

/** Soát MỘT đơn — hàm thuần. `don` null = đơn đã bị dọn (dựng từ phiếu). */
export function soatMotDon(d: DuLieuMotDon, cfg: CauHinhKiem, bayGio: Date = new Date()): DongKiemLai {
    const don = d.don, phieu = d.phieu
    const orderNumber = don?.orderNumber || String(phieu?.receiptNumber || '').replace(/^ONLINE-/, '')
    const status = don ? String(don.status || '') : null
    const platform = nenTangCuaMa(don, orderNumber)
    const daDon = !don
    const huy = !!status && HUY.has(status)
    const dangHuy = status === 'IN_CANCEL'
    const choXN = !!status && CHO_XAC_NHAN.has(status)
    const daGiao = !!don && (DA_GIAO.has(status!) || !!don.deliveredAt)
    const sanBaoTra = !!status && SAN_BAO_TRA.has(status)
    const traHangs = [...(d.traHangs || [])].sort((a, b) => (TRA_UU_TIEN[b.status] ?? 0) - (TRA_UU_TIEN[a.status] ?? 0))
    const hoanTien = traHangs.some(t => t.status === 'refunded')
    const traDangXuLy = traHangs.some(t => ['pending', 'approved', 'processing'].includes(t.status))
    const coTra = traHangs.length > 0 || sanBaoTra
    /** Hàng đợi 20:30 chỉ né đơn sàn báo trả hoặc có phiếu trả ĐANG MỞ (pending/approved/processing/refunded — OPEN_RETURN_EXISTS ở
     *  routes/einvoice); trả bị TỪ CHỐI thì đơn vẫn có hiệu lực và vẫn được xuất HĐ (30/10/2026) */
    const traChanHd = sanBaoTra || hoanTien || traDangXuLy
    const phieuDao = phieu?.status === 'voided'
    const mstKhai = mstKhachKhai(phieu?.vatBuyerInfo)

    // HĐ đang hiệu lực = đã xuất, có số, chưa bị thay thế, không phải bản điều chỉnh (bản mới nhất)
    const hds = d.hoaDons
    const hd = hds
        ? hds.filter(h => HD_HIEU_LUC.has(String(h.status)) && h.invoiceNumber && !h.replacedByInvoiceId && String(h.invoiceType || 'SALE').toUpperCase() !== 'ADJUSTMENT')
            .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0]
        : undefined
    const hdLoi = hds ? hds.filter(h => String(h.status) === 'ERROR').sort((a, b) => time(b.createdAt) - time(a.createdAt))[0] : undefined

    // ── 1. Ghi nhận ───────────────────────────────────────────────────────
    let phieuB: Buoc
    if (huy) {
        phieuB = phieu && !phieuDao
            ? { tt: 'loi', ghiChu: `Đơn ${status} mà phiếu ${phieu.receiptNumber} chưa đảo`, hanhDong: 'Xử lý huỷ đơn (đảo phiếu)' }
            : { tt: 'bo_qua', ghiChu: status === 'UNPAID' ? 'Chưa thanh toán' : 'Đơn huỷ' }
    } else if (!phieu) {
        if (choXN) phieuB = { tt: 'cho', ghiChu: 'Chờ xác nhận bên sàn — chưa lên phiếu' }
        else if (dangHuy) phieuB = { tt: 'cho', ghiChu: 'Đang huỷ' }
        else if (sanBaoTra) phieuB = { tt: 'bo_qua', ghiChu: 'Đơn trả, chưa từng lên phiếu' }
        else if (don?.khongKhopSku) phieuB = { tt: 'loi', ghiChu: 'Chưa lên phiếu: mã hàng sàn chưa nối hàng kho', hanhDong: 'Ánh xạ SKU rồi Chuyển lại đơn' }
        else if (don && (LEN_PHIEU.has(status!) || status === 'TO_CONFIRM_RECEIVE')) phieuB = { tt: 'loi', ghiChu: `Đơn ${status} mà chưa lên phiếu`, hanhDong: 'Chuyển lại đơn' }
        else phieuB = { tt: 'cho', ghiChu: `Đơn ${status || '?'} — chưa tới lúc lên phiếu` }
    } else {
        const loi: string[] = []
        let hanhDong: string | undefined
        const thieu = dongChuaNoi(phieu.notes)
        if (thieu > 0) { loi.push(`${thieu} dòng hàng chưa nối hàng kho, bị bỏ khỏi phiếu`); hanhDong = 'Ánh xạ SKU rồi Chuyển lại đơn' }
        else if (d.tongDong && d.tongDong.soDong === 0) { loi.push('phiếu không có dòng hàng'); hanhDong = 'Ánh xạ SKU rồi Chuyển lại đơn' }
        if (don && Math.abs((Number(don.total) || 0) - (Number(phieu.total) || 0)) > 1) { loi.push(`tổng phiếu ${dinhTien(phieu.total)} ≠ tổng đơn ${dinhTien(don.total)}`); hanhDong = hanhDong || 'Xem lại phiếu' }
        if (phieuDao && !coTra && !dangHuy) { loi.push(`phiếu đã đảo (voided) mà đơn ${status || 'đã dọn'} không trả / huỷ`); hanhDong = hanhDong || 'Xem lại phiếu' }
        if (cfg.soatSo && d.coSoSale === false && !phieuDao) { loi.push('chưa có bút toán bán hàng (SALE)'); hanhDong = hanhDong || 'Đối chiếu sổ sách › Ghi bù' }
        phieuB = loi.length
            ? { tt: 'loi', ghiChu: loi.join('; '), hanhDong }
            : { tt: 'ok', ghiChu: `Phiếu ${phieu.receiptNumber}${phieuDao ? ' (đã đảo)' : d.coSoSale ? ', đã vào sổ' : ''}` }
    }

    // ── 2. Phí sàn ────────────────────────────────────────────────────────
    let phiB: Buoc
    let phiSan: number | null = null, thucNhan: number | null = null
    if (platform === 'lazada') phiB = { tt: 'bo_qua', ghiChu: 'Lazada chưa có API phí' }
    else if (huy) phiB = { tt: 'bo_qua', ghiChu: 'Đơn huỷ' }
    else if (don) {
        if (phiDaQuyetToan(don)) {
            phiSan = Number(don.platformFee) || 0; thucNhan = Number(don.netRevenue) || 0
            phiB = { tt: 'ok', ghiChu: `Phí ${dinhTien(phiSan)}, thực nhận ${dinhTien(thucNhan)}${thucNhan < 0 ? ' (quyết toán âm — hoàn tiền)' : ''}` }
        } else if (daGiao || sanBaoTra) {
            const uocTinh = (Number(don.platformFeeRate) || 0) > 0 && (Number(don.platformFee) || 0) !== 0
            phiB = { tt: 'loi', ghiChu: uocTinh ? 'Chỉ có phí ƯỚC TÍNH theo %, chưa có số thật' : 'Chưa lấy được phí thật từ sàn', hanhDong: 'Đồng bộ phí (kênh › Lấy phí thật)' }
        } else phiB = { tt: 'cho', ghiChu: 'Chờ sàn quyết toán' }
    } else if (phieuDao) phiB = { tt: 'bo_qua', ghiChu: 'Phiếu đã đảo' }
    else if (d.phiGiu === undefined) phiB = { tt: 'khong_ro', ghiChu: 'Không đọc được bảng phí giữ lại (PhiSanDon)' }
    else if (!d.phiGiu) phiB = { tt: 'loi', ghiChu: 'Đơn đã dọn, chưa giữ được số phí', hanhDong: 'Lấy lại phí đơn đã dọn' }
    else if (!d.phiGiu.netRevenue) phiB = { tt: 'loi', ghiChu: 'Đã hỏi sàn, sàn chưa có số phí', hanhDong: 'Lấy lại phí đơn đã dọn' }
    else {
        phiSan = Number(d.phiGiu.platformFee) || 0; thucNhan = Number(d.phiGiu.netRevenue) || 0
        phiB = { tt: 'ok', ghiChu: `Phí ${dinhTien(phiSan)}, thực nhận ${dinhTien(thucNhan)} (giữ lại khi dọn đơn)` }
    }

    // ── 3. Hoá đơn điện tử ────────────────────────────────────────────────
    let hoaDonB: Buoc
    const soHoaDon = hd?.invoiceNumber || null
    const gioTuKhiGiao = don?.deliveredAt ? (bayGio.getTime() - time(don.deliveredAt)) / 3600_000 : null
    if (!cfg.dungHoaDonDienTu) hoaDonB = { tt: 'bo_qua', ghiChu: 'Cửa hàng không dùng HĐĐT' }
    else if (hds === null || hds === undefined) hoaDonB = { tt: 'khong_ro', ghiChu: 'Không đọc được bảng hoá đơn' }
    else if (hd) {
        const loi: string[] = []
        if (phieu && !hd.adjustedByInvoiceId && Math.abs((Number(hd.totalAmount) || 0) - (Number(phieu.total) || 0)) > 1) loi.push(`HĐ ${hd.invoiceNumber} ghi ${dinhTien(hd.totalAmount)} ≠ phiếu ${dinhTien(phieu.total)}`)
        const mstHd = String(hd.buyerTaxCode || '').replace(/\s+/g, '')
        if (mstKhai && mstHd !== mstKhai) loi.push(`khách khai MST ${mstKhai} mà HĐ ${hd.invoiceNumber} ${mstHd ? `mang MST ${mstHd}` : 'không có MST'}`)
        hoaDonB = loi.length
            ? { tt: 'loi', ghiChu: loi.join('; '), hanhDong: 'Xuất HĐ thay thế' }
            : { tt: 'ok', ghiChu: `HĐ ${hd.invoiceNumber}${hd.invoiceDate ? ` ngày ${ddmm(hd.invoiceDate)}` : ''}${hd.adjustedByInvoiceId ? ' (đã có bản điều chỉnh)' : ''}` }
    }
    else if (huy || phieuDao) hoaDonB = { tt: 'bo_qua', ghiChu: huy ? 'Đơn huỷ' : 'Phiếu đã đảo' }
    else if (!phieu) hoaDonB = { tt: 'bo_qua', ghiChu: 'Chưa có phiếu để xuất' }
    else if (hdLoi) hoaDonB = { tt: 'loi', ghiChu: `Xuất HĐ lỗi: ${String(hdLoi.errorMessage || 'không rõ lý do').slice(0, 140)}`, hanhDong: 'Xuất lại ở Hàng đợi xuất HĐ' }
    else if (traChanHd) hoaDonB = { tt: 'cho', ghiChu: 'Có trả hàng — hàng đợi không xuất' }
    else if (!daDon && !daGiao) hoaDonB = { tt: 'cho', ghiChu: 'Chờ giao xong mới xuất' }
    else if (gioTuKhiGiao !== null && gioTuKhiGiao < GIO_CHO_HANG_DOI) hoaDonB = { tt: 'cho', ghiChu: 'Mới giao — chờ hàng đợi 20:30' }
    else if (!cfg.tuXuat && !mstKhai) hoaDonB = { tt: 'cho', ghiChu: 'Tự xuất đang tắt — xuất tay ở Hàng đợi xuất HĐ' }
    else hoaDonB = { tt: 'loi', ghiChu: daDon ? 'Đơn đã xong (đã dọn) mà chưa xuất HĐ' : 'Đã giao mà chưa xuất HĐ (thiếu tồn kho thuế?)', hanhDong: 'Hàng đợi xuất HĐ' }

    // ── 4. Trả hàng ───────────────────────────────────────────────────────
    let traHangB: Buoc
    const moiNhat = traHangs[0]
    if (!coTra) traHangB = dangHuy ? { tt: 'cho', ghiChu: 'Đang huỷ' } : { tt: 'bo_qua', ghiChu: 'Không có trả hàng' }
    else if (!traHangs.length) traHangB = { tt: 'loi', ghiChu: `Sàn báo ${status} mà chưa có phiếu trả`, hanhDong: 'Đồng bộ trả hàng' }
    else if (hoanTien) {
        const loi: string[] = []
        if (phieu && !phieuDao) loi.push(`đã hoàn tiền mà phiếu ${phieu.receiptNumber} chưa đảo`)
        if (hd && !hd.adjustedByInvoiceId && !hd.replacedByInvoiceId) loi.push(`HĐ ${hd.invoiceNumber} chưa điều chỉnh sau trả hàng`)
        traHangB = loi.length
            ? { tt: 'loi', ghiChu: loi.join('; '), hanhDong: loi[0]!.startsWith('HĐ') ? 'Hoá đơn › Cần điều chỉnh' : 'Xử lý phiếu trả' }
            : { tt: 'ok', ghiChu: `Đã hoàn tiền (${moiNhat!.code})` }
    }
    else if (traDangXuLy) traHangB = { tt: 'cho', ghiChu: `Phiếu trả ${moiNhat!.code} đang ${moiNhat!.status}` }
    else traHangB = { tt: 'ok', ghiChu: `Trả hàng ${moiNhat!.status === 'rejected' ? 'bị từ chối' : 'đã đóng'} (${moiNhat!.code})` }

    // ── 5. Hoàn tất ───────────────────────────────────────────────────────
    const cacBuoc = [phieuB, phiB, hoaDonB, traHangB]
    const loiDs = cacBuoc.filter(b => b.tt === 'loi')
    const khongRo = cacBuoc.filter(b => b.tt === 'khong_ro')
    const choDs = cacBuoc.filter(b => b.tt === 'cho')
    let hoanTatB: Buoc
    if (loiDs.length) hoanTatB = { tt: 'loi', ghiChu: `Còn ${loiDs.length} việc` }
    else if (khongRo.length) hoanTatB = { tt: 'khong_ro', ghiChu: 'Thiếu dữ liệu để kết luận' }
    else if (choDs.length) hoanTatB = { tt: 'cho', ghiChu: choDs.map(b => b.ghiChu).join('; ') }
    else if (huy) hoanTatB = { tt: 'ok', ghiChu: 'Đơn huỷ — không còn gì phải làm' }
    else if (daDon || daGiao || hoanTien) hoanTatB = { tt: 'ok', ghiChu: 'Hoàn tất' }
    else hoanTatB = { tt: 'cho', ghiChu: `Đơn đang ${status}` }

    return {
        id: don?.id || null, orderNumber, platform, channelId: don?.channelId || null, channelName: don?.channelName || null,
        status, createdAt: iso(don?.createdAt || phieu?.transactionDate || phieu?.createdAt), deliveredAt: iso(don?.deliveredAt),
        total: Number(don?.total ?? phieu?.total) || 0, customerName: don?.customerName || null,
        daDon, receiptNumber: phieu?.receiptNumber || null, soHoaDon, phiSan, thucNhan,
        phieu: phieuB, phi: phiB, hoaDon: hoaDonB, traHang: traHangB, hoanTat: hoanTatB,
        vanDe: loiDs.map(b => b.ghiChu),
    }
}

// ─── Nạp dữ liệu từ CSDL ────────────────────────────────────────────────────

const CHON_DON = {
    id: true, orderNumber: true, platform: true, channelId: true, channelName: true, status: true, total: true, createdAt: true,
    deliveredAt: true, customerName: true, platformFee: true, platformFeeRate: true, netRevenue: true, khongKhopSku: true,
} as const
const CHON_PHIEU = { id: true, receiptNumber: true, status: true, total: true, notes: true, vatBuyerInfo: true, transactionDate: true, createdAt: true } as const
/** transactionId PHẢI có: hàm nạp gom HĐ theo phiếu bằng chính cột này — thiếu thì mọi HĐ rơi vào khoá '' và đơn nào cũng
 *  thành "chưa xuất HĐ" (30/10/2026, chủ shop: chi tiết đơn nói ĐÃ xuất mà tab Kiểm lại nói chưa) */
const CHON_HD = {
    id: true, transactionId: true, status: true, invoiceType: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, buyerTaxCode: true,
    replacedByInvoiceId: true, adjustedByInvoiceId: true, errorMessage: true, createdAt: true,
} as const
const CHON_TRA = { code: true, status: true, originalInvoice: true, refundAmount: true, totalRefund: true } as const

function* lo<T>(ds: T[]): Generator<T[]> { for (let i = 0; i < ds.length; i += LO) yield ds.slice(i, i + LO) }

/** Cửa hàng này có dùng HĐĐT / tự xuất / có soát sổ kép không */
export async function docCauHinhKiem(sp: any): Promise<CauHinhKiem> {
    let dungHoaDonDienTu = false, tuXuat = false
    try {
        const c = await sp.eInvoiceConfig.findFirst({ where: { active: true } })
        if (c) {
            dungHoaDonDienTu = true
            try { tuXuat = !!JSON.parse(c.extra || '{}')?.autoIssueOnDelivery } catch { tuXuat = false }
        }
    } catch { /* cửa hàng chưa có bảng HĐĐT ⇒ không dùng */ }
    let soatSo = true
    try {
        const cai = await sp.storeSettings.findFirst({ select: { autoCreateJournalEntries: true, businessType: true } })
        if (cai?.autoCreateJournalEntries === false) soatSo = false
        const loaiHinh = String(cai?.businessType || 'company')
        if (loaiHinh === 'household' || loaiHinh === 'individual') soatSo = false   // HKD không bắt buộc sổ kép (cùng luật viecCanLam)
    } catch { soatSo = false }
    return { dungHoaDonDienTu, tuXuat, soatSo }
}

const maTran = (orderNumber: string) => String(orderNumber).replace(/^(SPE|TIK|LZD)-/i, '')

/**
 * Kiểm lại mọi đơn sàn tạo trong [tu, den] (+ phiếu ONLINE- trong kỳ mà đơn đã bị dọn, chỉ khi không lọc kênh — phiếu không
 * mang kênh). `chiVanDe` = chỉ trả dòng còn việc. Trần TRAN đơn; chạm trần thì nói rõ.
 */
export async function kiemLaiDonSan(
    sp: any, o: { tu: Date; den: Date; channelId?: string | null; chiVanDe?: boolean; tran?: number; bayGio?: Date },
): Promise<KetQuaKiemLai> {
    const tran = o.tran ?? TRAN
    const bayGio = o.bayGio || new Date()
    const cauHinh = await docCauHinhKiem(sp)
    const dons: DonKiem[] = await sp.onlineOrder.findMany({
        where: { createdAt: { gte: o.tu, lte: o.den }, ...(o.channelId ? { channelId: o.channelId } : {}) },
        select: CHON_DON, orderBy: { createdAt: 'desc' }, take: tran,
    })
    const chamTran = dons.length >= tran

    // Phiếu của các đơn + phiếu ONLINE- trong kỳ không còn đơn (đã dọn)
    const phieuTheoSo = new Map<string, PhieuKiem>()
    for (const ds of lo(dons.map(d => `ONLINE-${d.orderNumber}`))) {
        for (const p of await sp.transaction.findMany({ where: { receiptNumber: { in: ds } }, select: CHON_PHIEU })) phieuTheoSo.set(p.receiptNumber, p)
    }
    if (!o.channelId) {
        const them: PhieuKiem[] = await sp.transaction.findMany({
            where: {
                channel: 'online', receiptNumber: { startsWith: 'ONLINE-' },
                OR: [{ transactionDate: { gte: o.tu, lte: o.den } }, { transactionDate: null, createdAt: { gte: o.tu, lte: o.den } }],
            },
            select: CHON_PHIEU, take: tran,
        })
        for (const p of them) if (!phieuTheoSo.has(p.receiptNumber)) phieuTheoSo.set(p.receiptNumber, p)
    }
    const coDon = new Set(dons.map(d => d.orderNumber))
    const phieuDaDon = [...phieuTheoSo.values()].filter(p => !coDon.has(p.receiptNumber.replace(/^ONLINE-/, '')))
    const phieuIds = [...phieuTheoSo.values()].map(p => p.id)

    // Σ dòng từng phiếu
    const tongDong = new Map<string, { tong: number; soDong: number }>()
    for (const ds of lo(phieuIds)) {
        const rows: any[] = await sp.$queryRawUnsafe(
            `SELECT "transactionId" AS id, COALESCE(SUM("lineTotal"), 0)::float AS tong, COUNT(*)::int AS "soDong" FROM "TransactionItem" WHERE "transactionId" = ANY($1::text[]) GROUP BY 1`, ds)
        for (const r of rows) tongDong.set(String(r.id), { tong: Number(r.tong) || 0, soDong: Number(r.soDong) || 0 })
    }
    // Bút toán SALE-<phiếu>
    let soSale: Set<string> | null = null
    if (cauHinh.soatSo) {
        soSale = new Set()
        try {
            for (const ds of lo([...phieuTheoSo.keys()])) {
                for (const e of await sp.journalEntry.findMany({ where: { reference: { in: ds.map(s => `SALE-${s}`) } }, select: { reference: true } })) soSale.add(String(e.reference).replace(/^SALE-/, ''))
            }
        } catch { soSale = null }
    }
    // Hoá đơn điện tử
    let hdTheoPhieu: Map<string, HoaDonKiem[]> | null = new Map()
    if (cauHinh.dungHoaDonDienTu) {
        try {
            for (const ds of lo(phieuIds)) {
                for (const h of await sp.eInvoice.findMany({ where: { transactionId: { in: ds } }, select: CHON_HD })) {
                    const k = String(h.transactionId || '')
                    hdTheoPhieu!.set(k, [...(hdTheoPhieu!.get(k) || []), h])
                }
            }
        } catch { hdTheoPhieu = null }
    }
    // Phiếu trả: originalInvoice = mã đơn, hoặc mã sàn trần (returnSync ghi mã trần khi không tìm thấy đơn)
    const maDonTatCa = [...coDon, ...phieuDaDon.map(p => p.receiptNumber.replace(/^ONLINE-/, ''))]
    const theoMaTran = new Map<string, string>(maDonTatCa.map(m => [maTran(m), m]))
    const traTheoMa = new Map<string, TraHangKiem[]>()
    for (const ds of lo([...new Set([...maDonTatCa, ...theoMaTran.keys()])])) {
        for (const t of await sp.returnOrder.findMany({ where: { originalInvoice: { in: ds } }, select: CHON_TRA })) {
            const goc = String(t.originalInvoice || '')
            const ma = coDon.has(goc) || maDonTatCa.includes(goc) ? goc : (theoMaTran.get(goc) || goc)
            traTheoMa.set(ma, [...(traTheoMa.get(ma) || []), t])
        }
    }
    // Phí giữ lại của đơn đã dọn
    let phiGiu: Map<string, PhiGiuKiem> | null = new Map()
    if (phieuDaDon.length) {
        try {
            for (const ds of lo(phieuDaDon.map(p => p.receiptNumber.replace(/^ONLINE-/, '')))) {
                const rows: any[] = await sp.$queryRawUnsafe(`SELECT "orderNumber", "platformFee", "netRevenue", "nguon" FROM "PhiSanDon" WHERE "orderNumber" = ANY($1::text[])`, ds)
                for (const r of rows) phiGiu!.set(String(r.orderNumber), { platformFee: Number(r.platformFee) || 0, netRevenue: Number(r.netRevenue) || 0, nguon: String(r.nguon || '') })
            }
        } catch { phiGiu = null }
    }

    const ds: DongKiemLai[] = []
    for (const don of dons) {
        const so = `ONLINE-${don.orderNumber}`
        const phieu = phieuTheoSo.get(so) || null
        ds.push(soatMotDon({
            don, phieu, tongDong: phieu ? (tongDong.get(phieu.id) || { tong: 0, soDong: 0 }) : null,
            coSoSale: phieu && soSale ? soSale.has(so) : null,
            hoaDons: phieu ? (hdTheoPhieu ? (hdTheoPhieu.get(phieu.id) || []) : null) : [],
            traHangs: traTheoMa.get(don.orderNumber) || [], phiGiu: undefined,
        }, cauHinh, bayGio))
    }
    for (const phieu of phieuDaDon) {
        const ma = phieu.receiptNumber.replace(/^ONLINE-/, '')
        ds.push(soatMotDon({
            don: null, phieu, tongDong: tongDong.get(phieu.id) || { tong: 0, soDong: 0 },
            coSoSale: soSale ? soSale.has(phieu.receiptNumber) : null,
            hoaDons: hdTheoPhieu ? (hdTheoPhieu.get(phieu.id) || []) : null,
            traHangs: traTheoMa.get(ma) || [], phiGiu: phiGiu ? (phiGiu.get(ma) || null) : undefined,
        }, cauHinh, bayGio))
    }
    ds.sort((a, b) => time(b.createdAt) - time(a.createdAt))

    const dem = (): DemBuoc => ({ ok: 0, loi: 0, cho: 0, bo_qua: 0, khong_ro: 0 })
    const theoBuoc = { phieu: dem(), phi: dem(), hoaDon: dem(), traHang: dem(), hoanTat: dem() }
    for (const r of ds) for (const k of Object.keys(theoBuoc) as Array<keyof typeof theoBuoc>) theoBuoc[k][r[k].tt]++
    return {
        tu: o.tu.toISOString(), den: o.den.toISOString(), cauHinh,
        tongQuan: {
            soDon: ds.length, daDon: phieuDaDon.length, hoanTat: theoBuoc.hoanTat.ok, coVanDe: theoBuoc.hoanTat.loi,
            dangCho: theoBuoc.hoanTat.cho, chamTran, theoBuoc,
        },
        ds: o.chiVanDe ? ds.filter(r => r.hoanTat.tt === 'loi') : ds,
    }
}
