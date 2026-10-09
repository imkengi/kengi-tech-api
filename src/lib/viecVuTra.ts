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

/* ─── TỪNG LƯỢT KHIẾU NẠI (09/10/2026 — chủ shop: "khi khiếu nại lần 2, lần 3 thì chưa hiện lên") ───
 * Bản cũ chỉ coi dòng "[Khiếu nại]" do APP ghi là khiếu nại và lấy phán quyết cuối sau dòng đó. Khiếu
 * nại lại trên Seller Center thì sàn chuyển ACCEPTED → SELLER_DISPUTE, phiếu có thêm dòng mà kết quả
 * vẫn đứng ở "Bị từ chối" của lần 1 — lần 2 coi như không có. Nay: một LƯỢT bắt đầu khi app ghi
 * "[Khiếu nại]"/"[Từ chối TikTok]" HOẶC sàn sang SELLER_DISPUTE / JUDGING, mà lúc đó không có lượt
 * nào đang chờ; lượt kết thúc ở phán quyết đầu tiên sau nó. Phán quyết tiếp theo khi CHƯA khiếu nại
 * lại (vd ACCEPTED → REFUND_PAID) cập nhật kết quả lượt cuối. Bản sao web: ChiTietVuTra.tsx. */
export type LoaiKetQua = 'thua' | 'thang' | 'cho'
export interface VongKhieuNai {
    lan: number
    /** 'app' = khiếu nại từ Kengi, 'seller_center' = sàn ghi SELLER_DISPUTE / JUDGING */
    nguon: 'app' | 'seller_center'
    batDau?: string
    loai: LoaiKetQua
    nhan: string
    luc?: string
}
const CHO_PHAN_XU = 'Đang chờ sàn phân xử'

/** Mã gốc của sàn là PHÁN QUYẾT nào — null = bước trung gian. */
function phanQuyet(ma: string): { loai: LoaiKetQua; nhan: string } | null {
    if (/REFUND_PAID|SUCCESS|COMPLETE/.test(ma)) return { loai: 'thua', nhan: 'Bị từ chối — sàn đã hoàn tiền cho khách' }
    if (/^ACCEPTED$|AWAITING_BUYER_SHIP|BUYER_SHIPPED_ITEM/.test(ma)) return { loai: 'thua', nhan: 'Bị từ chối — sàn cho khách trả hàng/hoàn tiền' }
    if (/CLOSED|CANCEL|REJECT/.test(ma)) return { loai: 'thang', nhan: 'Thắng — vụ đã đóng, khách không được hoàn tiền' }
    return null
}

export function vongKhieuNai(notes?: string | null): VongKhieuNai[] {
    const vong: VongKhieuNai[] = []
    let mo: VongKhieuNai | null = null
    for (const tho of String(notes || '').split(/\r?\n/)) {
        const dong = tho.trim()
        const app = /^\[(?:Khiếu nại|Từ chối TikTok)\]\s*(.*)$/.exec(dong)
        if (app) {
            if (!mo) {
                mo = { lan: vong.length + 1, nguon: 'app', batDau: String(app[1] || '').split(' — ')[0] || undefined, loai: 'cho', nhan: CHO_PHAN_XU }
                vong.push(mo)
            }
            continue
        }
        const m = /^\[(?:Shopee|TikTok)\]\s*(?:Status:\s*)?([A-Z_]+)(?:\s*\(([^)]*)\))?/.exec(dong)
        if (!m) continue
        const ma = m[1] || '', luc = m[2]
        if (/^(SELLER_DISPUTE|JUDGING)$/.test(ma)) {
            if (!mo) {
                mo = { lan: vong.length + 1, nguon: 'seller_center', batDau: luc, loai: 'cho', nhan: CHO_PHAN_XU }
                vong.push(mo)
            }
            continue
        }
        const pq = phanQuyet(ma)
        if (!pq) continue
        const dich = mo || vong[vong.length - 1]
        if (!dich) continue   // phán quyết TRƯỚC mọi lượt khiếu nại — không phải kết quả khiếu nại
        dich.loai = pq.loai
        dich.nhan = pq.nhan
        dich.luc = luc
        mo = null
    }
    return vong
}

/** Kết quả lượt khiếu nại CUỐI + tổng số lượt; null = vụ chưa từng khiếu nại (app hay Seller Center). */
export function ketQuaKhieuNai(notes?: string | null): (VongKhieuNai & { soLan: number }) | null {
    const v = vongKhieuNai(notes)
    if (!v.length) return null
    return { ...v[v.length - 1]!, soLan: v.length }
}

/** Đã khiếu nại (từ app hay trên Seller Center) — dùng cho việc "chưa khiếu nại". */
export const daKhieuNai = (notes?: string | null) => vongKhieuNai(notes).length > 0

/** "Tracking: X" — mã vận đơn HÀNG TRẢ; N/A = khách chưa gửi. Cùng luật route /returns/list. */
export function maVanDonTra(notes?: string | null): string | null {
    const m = /(?:^|\n)\s*Tracking:\s*(.+?)\s*(?:\n|$)/i.exec(notes || '')
    const v = m?.[1]?.trim()
    return !v || v.toUpperCase() === 'N/A' ? null : v
}

/** "Need return: Có" — khách phải gửi hàng lại. (\b của JS không hiểu chữ "ó" → dùng lookahead.) */
export const canGuiHangLai = (notes?: string | null) => /(?:^|\n)\s*Need return:\s*Có(?=\s|$)/.test(String(notes || ''))

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
    /** trạm quay ghi "[Nhận hàng hoàn]" vào đây khi kiện giao thất bại về tới shop */
    internalNote?: string | null
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

        // Khách PHẢI gửi hàng lại, đã có mã vận đơn trả, vụ đã được chấp nhận → kiện đang về.
        // Trạm quay đã ghi "[Nhận hàng hoàn]" (09/10/2026) = đã nhận — chắc hơn dò tên video.
        const trk = maVanDonTra(notes)
        if (trk && canGuiHangLai(notes) && (r.status === 'approved' || r.status === 'refunded') && !notes.includes('[Nhận hàng hoàn]')) {
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
        if (trk.length < 6 || !d.shippedAt || String(d.internalNote || '').includes('[Nhận hàng hoàn]')) continue
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
