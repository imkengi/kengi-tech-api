// ─────────────────────────────────────────────────────────────────────────────
//  VIỆC CỦA VỤ TRẢ / HÀNG HOÀN — ba danh sách cho "Việc cần làm › Bán hàng online"
//  (chủ shop 09/10/2026: "các đơn chưa khiếu nại, khiếu nại thất bại để khiếu nại
//  lại, các đơn hoàn về chưa nhận").
//
//  Đọc đúng những gì returnSync ghi vào ghi chú phiếu: "[Shopee] MÃ (giờ)",
//  "[Khiếu nại] …" / "[Từ chối TikTok] …", "Tracking: …", "Need return: Có/Không".
//  ketQuaKhieuNai là bản sao luật của web ChiTietVuTra.tsx — sửa một bên nhớ sửa
//  bên kia. Hàm ở đây THUẦN (không DB, không Drive) để thử được bằng tsx.
// ─────────────────────────────────────────────────────────────────────────────

import { dichLyDoTraHang } from './lyDoTraHang'

export interface DongViec {
    /** mã hiển thị: mã phiếu trả / mã đơn / mã vận đơn */
    ma: string
    moTa: string
    /** trang mở đúng phiếu / đơn đó */
    duongDan: string
    tuoiNgay: number
}

const MOT_NGAY = 86_400_000
const fmtTien = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0)) + '₫'
const tuoi = (tu: Date | string, homNay: Date) =>
    Math.max(0, Math.floor((homNay.getTime() - new Date(tu).getTime()) / MOT_NGAY))
const lienPhieu = (code: string) => `/dashboard-online-orders?tab=returns&tim=${encodeURIComponent(code)}`
const lienDon = (so: string) => `/dashboard-online-orders?tab=orders&tim=${encodeURIComponent(so)}`

/** Mã trạng thái GỐC cuối cùng sàn ghi vào ghi chú ("[Shopee] ACCEPTED (…)" / "Status: …"). */
export function maGocCuoi(notes?: string | null): string {
    const s = String(notes || '')
    const re = /\[(?:Shopee|TikTok)\]\s*(?:Status:\s*)?([A-Z_]+)/g
    let cuoi = ''
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) cuoi = m[1] || cuoi
    return cuoi
}

export const daKhieuNai = (notes?: string | null) => /\[(Khiếu nại|Từ chối TikTok)\]/.test(String(notes || ''))

/** "Tracking: X" — mã vận đơn HÀNG TRẢ; N/A = khách chưa gửi. Cùng luật route /returns/list. */
export function maVanDonTra(notes?: string | null): string | null {
    const m = /(?:^|\n)\s*Tracking:\s*(.+?)\s*(?:\n|$)/i.exec(notes || '')
    const v = m?.[1]?.trim()
    return !v || v.toUpperCase() === 'N/A' ? null : v
}

/** "Need return: Có" — khách phải gửi hàng lại. (\b của JS không hiểu chữ "ó" → dùng lookahead.) */
export const canGuiHangLai = (notes?: string | null) => /(?:^|\n)\s*Need return:\s*Có(?=\s|$)/.test(String(notes || ''))

/** KẾT QUẢ KHIẾU NẠI — trạng thái QUYẾT ĐỊNH cuối cùng SAU dòng khiếu nại cuối. Sàn chấp nhận
 *  trả / hoàn tiền = THUA; đóng / huỷ / từ chối = THẮNG; chưa có = chờ. Bản sao web. */
export function ketQuaKhieuNai(notes?: string | null): { loai: 'thua' | 'thang' | 'cho'; nhan: string; luc?: string } | null {
    const s = String(notes || '')
    const viTri = Math.max(s.lastIndexOf('[Khiếu nại]'), s.lastIndexOf('[Từ chối TikTok]'))
    if (viTri < 0) return null
    let kq: { loai: 'thua' | 'thang' | 'cho'; nhan: string; luc?: string } | null = null
    const re = /\[(Shopee|TikTok)\] ([A-Z_]+)(?: \(([^)]*)\))?/g
    const sau = s.slice(viTri)
    let m: RegExpExecArray | null
    while ((m = re.exec(sau)) !== null) {
        const ma = m[2] || '', luc = m[3]
        if (/REFUND_PAID|SUCCESS|COMPLETE/.test(ma)) kq = { loai: 'thua', nhan: 'Bị từ chối — sàn đã hoàn tiền cho khách', luc }
        else if (/^ACCEPTED$|AWAITING_BUYER_SHIP|BUYER_SHIPPED_ITEM/.test(ma)) kq = { loai: 'thua', nhan: 'Bị từ chối — sàn cho khách trả hàng/hoàn tiền', luc }
        else if (/CLOSED|CANCEL|REJECT/.test(ma)) kq = { loai: 'thang', nhan: 'Thắng — vụ đã đóng, khách không được hoàn tiền', luc }
    }
    return kq ?? { loai: 'cho', nhan: 'Đang chờ sàn phân xử' }
}

export interface PhieuTraDoc {
    code: string
    status: string
    notes: string | null
    reason: string | null
    totalRefund: number | null
    createdAt: Date | string
    updatedAt: Date | string
}

export interface DonHuyDaGiao {
    orderNumber: string
    platform: string | null
    trackingNumber: string | null
    shippedAt: Date | string | null
    total: number | null
}

/** Kiện đang/đã hoàn về: mã vận đơn để dò video mở hàng + dòng hiển thị. */
export interface KienHoan { maVanDon: string; soTien: number; dong: DongViec }

// Mã gốc cho thấy vụ ĐÃ có quyết định / đang khiếu nại — không còn là "chưa khiếu nại".
// TikTok tên mới REQUEST_REJECTED quy đổi thành 'pending' nên PHẢI chặn bằng mã gốc.
const DA_QUYET_HOAC_DANG_KHIEU_NAI = /SELLER_DISPUTE|JUDGING|CANCEL|CLOS|REJECT|SUCCESS|COMPLETE|REFUND_PAID/

/** Chia phiếu trả sàn thành ba danh sách việc. Cũ nhất lên đầu (gần hạn nhất / lâu nhất). */
export function phanLoaiVuTra(ds: PhieuTraDoc[], homNay = new Date()) {
    const chuaKhieuNai: (DongViec & { soTien: number })[] = []
    const khieuNaiThua: (DongViec & { soTien: number })[] = []
    const choHoan: KienHoan[] = []
    for (const r of ds) {
        const notes = r.notes || ''
        const t = tuoi(r.createdAt, homNay)
        const soTien = Number(r.totalRefund) || 0
        const goc = maGocCuoi(notes)

        if (r.status === 'pending' && !daKhieuNai(notes) && !DA_QUYET_HOAC_DANG_KHIEU_NAI.test(goc)) {
            chuaKhieuNai.push({
                ma: r.code, soTien, tuoiNgay: t, duongDan: lienPhieu(r.code),
                moTa: `${dichLyDoTraHang(r.reason) || 'Không rõ lý do'} · ${fmtTien(soTien)} · ${t === 0 ? 'hôm nay' : `${t} ngày`}`,
            })
        }

        const kq = ketQuaKhieuNai(notes)
        // Đã hoàn tiền thì sàn đóng vụ — khiếu nại lại không còn cửa, không đưa vào việc.
        if (kq?.loai === 'thua' && r.status !== 'refunded' && tuoi(r.updatedAt, homNay) <= 30) {
            khieuNaiThua.push({
                ma: r.code, soTien, tuoiNgay: t, duongDan: lienPhieu(r.code),
                moTa: `${kq.nhan}${kq.luc ? ` · ${kq.luc}` : ''} · ${fmtTien(soTien)}`,
            })
        }

        // Khách PHẢI gửi hàng lại, đã có mã vận đơn trả, vụ đã được chấp nhận → kiện đang về
        const trk = maVanDonTra(notes)
        if (trk && canGuiHangLai(notes) && (r.status === 'approved' || r.status === 'refunded')) {
            choHoan.push({
                maVanDon: trk, soTien,
                dong: { ma: trk, tuoiNgay: t, duongDan: lienPhieu(r.code), moTa: `Hàng khách trả · ${r.code} · ${t} ngày` },
            })
        }
    }
    const cuTruoc = (a: { tuoiNgay: number }, b: { tuoiNgay: number }) => b.tuoiNgay - a.tuoiNgay
    chuaKhieuNai.sort(cuTruoc)
    khieuNaiThua.sort(cuTruoc)
    return { chuaKhieuNai, khieuNaiThua, choHoan }
}

/** Đơn bị huỷ SAU KHI ĐVVC đã lấy hàng (shippedAt = pickup_done_time / collection_time / shipped_at)
 *  = giao thất bại / huỷ giữa đường → kiện quay về shop bằng chính mã vận đơn gửi đi. */
export function kienHoanTuDonHuy(ds: DonHuyDaGiao[], homNay = new Date()): KienHoan[] {
    const ra: KienHoan[] = []
    for (const d of ds) {
        const trk = String(d.trackingNumber || '').trim()
        if (trk.length < 6 || !d.shippedAt) continue
        const t = tuoi(d.shippedAt, homNay)
        ra.push({
            maVanDon: trk, soTien: Number(d.total) || 0,
            dong: { ma: trk, tuoiNgay: t, duongDan: lienDon(d.orderNumber), moTa: `Giao thất bại · đơn ${d.orderNumber} · ${t} ngày` },
        })
    }
    return ra
}

/** Kiện nào CHƯA có video mở hàng hoàn. `tenVideo` đã viết HOA. Mã quá ngắn bỏ qua (dễ khớp nhầm). */
export function kienChuaNhan(cho: KienHoan[], tenVideo: string[]): KienHoan[] {
    const daGap = new Set<string>()
    const ra: KienHoan[] = []
    for (const k of cho) {
        const ma = k.maVanDon.toUpperCase()
        if (ma.length < 6 || daGap.has(ma)) continue
        daGap.add(ma)
        if (!tenVideo.some(t => t.includes(ma))) ra.push(k)
    }
    return ra.sort((a, b) => b.dong.tuoiNgay - a.dong.tuoiNgay)
}
