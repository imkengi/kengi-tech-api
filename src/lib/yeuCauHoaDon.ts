// ─────────────────────────────────────────────────────────────────────────────
//  TRANG KHÁCH TỰ LẤY HOÁ ĐƠN — kengi.vn/hoadon (20/10/2026, chủ shop: "thêm mục kengi.vn/hoadon/ để khách nhập
//  đơn hàng lấy hoá đơn" + "khách nhập mã đơn để lấy hoá đơn bảo hành nữa"). Hàm THUẦN cho routes/yeuCauHoaDon.ts —
//  tách riêng để soát được không cần CSDL (scripts/check-yeu-cau-hoa-don.ts).
//
//  Đo 20/10/2026 (chỉ đọc): CHỈ KENGISTORE dùng HĐĐT thật (VNPT, tự xuất bật từ 31/07); 3.907 đơn sàn, mã đơn luôn
//  = tiền tố + '-' + mã sàn: SPE (Shopee, 14 ký tự) 2.691, TIK (TikTok, 18 số) 1.156, LZD (Lazada, 15 số) 60; không
//  có phiếu bán tại quầy. HĐ xuất trung vị ~5,5 ngày sau khi giao ⇒ khách nhận hàng rồi gửi MST vẫn kịp trước khi xuất.
// ─────────────────────────────────────────────────────────────────────────────

import { mstHopLe } from './hoaDonKhach'

/** Tiền tố mã đơn trong hệ thống → tên sàn hiện cho khách */
export const KENH_THEO_TIEN_TO: Record<string, string> = { SPE: 'Shopee', TIK: 'TikTok', LZD: 'Lazada' }

/** Cửa hàng nhận yêu cầu qua trang công khai — biến môi trường, mặc định KENGISTORE (cửa hàng duy nhất có HĐĐT thật). */
export function cuaHangNhanYeuCau(env = process.env.HOA_DON_KHACH_CUA_HANG): string[] {
    const ds = String(env || 'KENGISTORE').split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9_-]{2,40}$/.test(s))
    return ds.length ? ds.slice(0, 5) : ['KENGISTORE']
}

/**
 * Mã khách gõ → các `OnlineOrder.orderNumber` ứng viên; `null` = sai dạng (chặn sớm, khỏi hỏi CSDL).
 * Khách thường dán mã sàn trần (Shopee "2610203UKRG5FA", TikTok 18 số) — có khi kèm dấu cách, '#', chữ thường,
 * hoặc dán nguyên mã trong hệ thống ("SPE-…", "ONLINE-SPE-…").
 */
export function ungVienMaDon(vao: unknown): string[] | null {
    const s = String(vao ?? '').toUpperCase().replace(/[\s#]/g, '').replace(/^ONLINE-/, '')
    if (!s || s.length > 40) return null
    if (/^(SPE|TIK|LZD)-[A-Z0-9]{6,30}$/.test(s)) return [s]
    if (!/^[A-Z0-9]{8,30}$/.test(s)) return null
    return Object.keys(KENH_THEO_TIEN_TO).map(t => `${t}-${s}`)
}

export type LoaiHoaDon = 'cong_ty' | 'ho_kd' | 'ca_nhan'
export const LOAI_HOA_DON: LoaiHoaDon[] = ['cong_ty', 'ho_kd', 'ca_nhan']

/** Dạng ghi vào Transaction.vatBuyerInfo — CÙNG khoá đường xuất HĐ đang đọc (routes/einvoice issueInvoiceForTransaction). */
export interface ThongTinNguoiMua {
    name: string
    taxCode: string
    address: string
    email: string
    nationalId: string
    loai: LoaiHoaDon
    nguon: 'khach-web'
    luc: string
}

/** Bỏ ký tự điều khiển, gom khoảng trắng, cắt độ dài — dữ liệu người lạ gõ vào. */
const sach = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** Kiểm & chuẩn hoá thông tin khách gửi. Lỗi trả câu tiếng Việt hiện thẳng cho khách. */
export function kiemYeuCau(b: any, now = new Date()): { ok: true; info: ThongTinNguoiMua } | { ok: false; loi: string } {
    const loai = String(b?.loai || '') as LoaiHoaDon
    if (!LOAI_HOA_DON.includes(loai)) return { ok: false, loi: 'Chọn loại hoá đơn: Công ty, Hộ kinh doanh hoặc Cá nhân' }
    const ten = sach(b?.ten, 200)
    const mst = sach(b?.mst, 20).replace(/\s+/g, '')
    const diaChi = sach(b?.diaChi, 300)
    const email = sach(b?.email, 120).toLowerCase()
    const cccd = sach(b?.cccd, 20).replace(/\s+/g, '')

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, loi: 'Email nhận hoá đơn chưa đúng' }
    if (loai === 'cong_ty' || loai === 'ho_kd') {
        if (!mst) return { ok: false, loi: 'Nhập mã số thuế' }
        if (!mstHopLe(mst)) return { ok: false, loi: 'Mã số thuế phải là 10 số, 10 số-3 số (chi nhánh), 12 hoặc 13 số' }
        if (ten.length < 2) return { ok: false, loi: loai === 'cong_ty' ? 'Nhập tên công ty / đơn vị' : 'Nhập tên hộ kinh doanh' }
        if (diaChi.length < 5) return { ok: false, loi: 'Nhập địa chỉ ghi trên hoá đơn' }
    } else {
        if (ten.length < 2) return { ok: false, loi: 'Nhập họ tên người mua' }
        if (mst && !mstHopLe(mst)) return { ok: false, loi: 'Mã số thuế cá nhân phải là 10 hoặc 12 số' }
        if (cccd && !/^(\d{9}|\d{12})$/.test(cccd)) return { ok: false, loi: 'Số CCCD phải là 12 số (CMND cũ 9 số)' }
    }
    return {
        ok: true,
        info: {
            name: ten,
            taxCode: mst,
            address: diaChi,
            email,
            nationalId: loai === 'ca_nhan' ? cccd : '',
            loai,
            nguon: 'khach-web',
            luc: now.toISOString(),
        },
    }
}

/**
 * 'chua_ghi_so' = đơn ĐÃ GIAO mà chưa có phiếu bán (đo 20/10/2026: 748 đơn COMPLETED như vậy ở KENGISTORE — mã hàng
 * sàn chưa nối được hàng kho nên orderSync chưa lên phiếu). KHÔNG được nói với khách là "chờ xác nhận".
 */
export type TrangThaiDonKhach = 'cho_xac_nhan' | 'chua_ghi_so' | 'dang_giao' | 'da_giao' | 'da_huy' | 'tra_hang'

/**
 * Trạng thái đơn nói với khách. Trạng thái lưu lẫn kiểu sàn (COMPLETED, TO_CONFIRM_RECEIVE, IN_TRANSIT, TO_RETURN…)
 * với kiểu nội bộ (delivered, cancelled…) — so không phân biệt hoa thường. Chưa có phiếu bán mà chưa giao ⇒ shop chưa
 * xác nhận (orderSync chỉ lên phiếu sau khi xác nhận).
 */
export function trangThaiDonKhach(o: { status?: string | null; deliveredAt?: any }, coPhieu: boolean): TrangThaiDonKhach {
    const st = String(o?.status || '').toLowerCase()
    if (/cancel|huy/.test(st)) return 'da_huy'
    if (/return|refund|hoan/.test(st)) return 'tra_hang'
    const daGiao = !!o?.deliveredAt || /deliver|complete|confirm_receive/.test(st)
    if (!coPhieu) return daGiao ? 'chua_ghi_so' : 'cho_xac_nhan'
    return daGiao ? 'da_giao' : 'dang_giao'
}

/** Che bớt khi nhắc lại thông tin đã gửi — ai có mã đơn cũng tra được, đừng để lộ MST / email người khác. */
export const cheMst = (m: string) => (m ? `***${String(m).slice(-3)}` : '')
export function cheEmail(e: string): string {
    const [u, d] = String(e || '').split('@')
    return u && d ? `${u[0]}***@${d}` : ''
}

/* ── BẢO MẬT (12/11/2026 — chủ shop duyệt sau tin Sapo lộ dữ liệu đơn) ────────────────────────────────────────────
 * Mã đơn sàn in trên tem dán ngoài kiện và nằm trong chính loại dữ liệu vận đơn đang bị rao bán ⇒ coi như CÔNG KHAI.
 * Nên CHỈ bằng mã đơn thì: (1) không tải thẳng được hoá đơn mang danh tính người mua — chỉ gửi về email đã khai;
 * (2) không ghi đè được thông tin người mua đã có trên phiếu; (3) thông tin có MST phải chờ nhân viên duyệt rồi mới xuất
 * (trước đó người lạ khai MST của mình là 20:30 cron tự xuất HĐĐT thật — gom HĐ đầu vào bằng đơn của người khác). */

/** Tên người mua kiểu bán lẻ chung chung — KHÔNG phải danh tính. Đo KENGISTORE 12/11/2026: 11.831/11.900 HĐ đã xuất ghi
 *  "Bán cho người tiêu dùng (…)", 38 "Khách TikTok"; ~31 tờ còn lại có MST / tên thật. */
const TEN_CHUNG = /^(bán cho người tiêu dùng|ban cho nguoi tieu dung|khách (lẻ|hàng lẻ|vãng lai|tiktok|shopee|lazada)|khach (le|hang le|vang lai|tiktok|shopee|lazada)|người mua không lấy (hoá|hóa) đơn|nguoi mua khong lay hoa don)/i

const CO_CHU = (x: any, k: string) => !!String(x?.[k] ?? '').trim()

/** Hoá đơn đã xuất có mang danh tính người mua không: khách đã gửi thông tin (vatBuyerInfo), có MST, tên KHÔNG chung chung,
 *  hay có địa chỉ. Có ⇒ trang công khai chỉ được GỬI EMAIL, không trả PDF. Tên/địa chỉ bị sàn che (`*`) thì không tính. */
export function hoaDonCoDanhTinh(
    hd: { buyerTaxCode?: string | null; buyerName?: string | null; buyerAddress?: string | null } | null | undefined,
    vbi: any,
): boolean {
    if (vbi && typeof vbi === 'object' && ['name', 'taxCode', 'address', 'email', 'nationalId'].some(k => CO_CHU(vbi, k))) return true
    if (!hd) return false
    if (CO_CHU(hd, 'buyerTaxCode')) return true
    const ten = String(hd.buyerName ?? '').normalize('NFC').trim()
    if (ten && !ten.includes('*') && !TEN_CHUNG.test(ten)) return true
    const dc = String(hd.buyerAddress ?? '').trim()
    return !!dc && !dc.includes('*')
}

export type KetQuaGui = 'trung' | 'cho_xuat' | 'cho_duyet' | 'can_thay_the' | 'da_co_ban_khac'
export interface QuyetDinhGui {
    /** ghi Transaction.vatBuyerInfo không */
    ghi: boolean
    /** ghi kèm cờ `choDuyet` ⇒ cron 20:30 KHÔNG tự xuất; nhân viên bấm Lưu ở hàng chờ HĐ (PUT …/buyer ghi lại không cờ) = duyệt */
    choDuyet: boolean
    /** báo nhân viên loại nào (null = không báo) */
    bao: null | 'khac_ban_cu' | 'can_duyet' | 'thay_the'
    ketQua: KetQuaGui
}

/** So nội dung, KHÔNG so `loai` (nhân viên lưu tay không có khoá này) */
const khoaThongTin = (x: any) => JSON.stringify(['name', 'taxCode', 'address', 'email', 'nationalId'].map(k => String(x?.[k] ?? '').trim().toLowerCase()))

/** Khách gửi thông tin xuất HĐ qua trang công khai thì làm gì. `cu` = vatBuyerInfo đang có trên phiếu (đã parse, hoặc null). */
export function quyetDinhGui(cu: any, moi: ThongTinNguoiMua, daXuatHd: boolean): QuyetDinhGui {
    const coCu = !!cu && typeof cu === 'object' && ['name', 'taxCode', 'address', 'email', 'nationalId'].some(k => CO_CHU(cu, k))
    if (coCu && khoaThongTin(cu) === khoaThongTin(moi)) {
        // Gửi lại y hệt (bấm hai lần, tải lại trang) ⇒ không ghi, không báo nhân viên lần hai
        return { ghi: false, choDuyet: !!cu.choDuyet, bao: null, ketQua: daXuatHd ? 'can_thay_the' : cu.choDuyet ? 'cho_duyet' : 'trung' }
    }
    // Phiếu đã có thông tin người mua (khách thật gửi trước, nhân viên nhập, hay lấy từ Shopee) ⇒ KHÔNG ghi đè
    if (coCu) return { ghi: false, choDuyet: false, bao: 'khac_ban_cu', ketQua: 'da_co_ban_khac' }
    // Đã xuất HĐ ⇒ chỉ còn đường thay thế, nhân viên tự bấm (đã là cửa duyệt)
    if (daXuatHd) return { ghi: true, choDuyet: false, bao: 'thay_the', ketQua: 'can_thay_the' }
    if (CO_CHU(moi, 'taxCode')) return { ghi: true, choDuyet: true, bao: 'can_duyet', ketQua: 'cho_duyet' }
    return { ghi: true, choDuyet: false, bao: null, ketQua: 'cho_xuat' }
}

/** Email được phép nhận bản HĐ CÓ DANH TÍNH thay cho tải thẳng (POST /tai-hoa-don). Chỉ tin email người mua khai
 *  TRƯỚC lúc xuất HĐ (nhân viên ghi, hoặc form web gửi trước mốc xuất): đơn đã xuất mà chưa có vatBuyerInfo thì form
 *  /gui vẫn ghi được (để điền sẵn HĐ thay thế) ⇒ email người lạ khai SAU mốc xuất không được nhận bản HĐ mang tên
 *  người mua thật. Không chứng minh được thứ tự (thiếu lúc gửi / thiếu mốc xuất) ⇒ null — thà bắt khách nhắn cửa hàng. */
export function emailNhanHoaDon(
    hd: { issuedAt?: Date | string | null; createdAt?: Date | string | null } | null | undefined, vbi: any,
): string | null {
    const email = String(vbi?.email ?? '').trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
    if (vbi?.nguon === 'khach-web') {
        const gui = Date.parse(String(vbi?.luc ?? ''))
        const mocRaw = hd?.issuedAt || hd?.createdAt
        const moc = mocRaw ? new Date(mocRaw as any).getTime() : NaN
        if (!Number.isFinite(gui) || !Number.isFinite(moc) || gui > moc) return null
    }
    return email
}

/** 'dd/mm/yyyy' theo giờ VN (máy chủ lưu UTC) */
export function ngayVN(d: any): string {
    if (!d) return ''
    const t = new Date(d)
    if (isNaN(t.getTime())) return ''
    return new Date(t.getTime() + 7 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/')
}

/** Mã phiếu bán của từng mã đơn ứng viên — cùng luật orderSync / lib/donDuocXoa (`ONLINE-<orderNumber>`). */
export const maPhieuUngVien = (ungVien: string[]): string[] => ungVien.map(m => `ONLINE-${m}`)

/** Phần phiếu bán (Transaction + dòng hàng) đủ để dựng lại tóm tắt đơn cho khách. */
export interface PhieuBanDonSan {
    receiptNumber: string
    status?: string | null
    total?: number | null
    createdAt?: any
    transactionDate?: any
    returnedAt?: any
    notes?: string | null
    items?: Array<{ productName?: string | null; quantity?: number | null; unitPrice?: number | null; lineTotal?: number | null }> | null
}

/** Đơn như route đọc từ OnlineOrder (cùng các cột select) — dựng được từ phiếu khi bản ghi đơn không còn. */
export interface DonKhach {
    orderNumber: string
    platform: string | null
    channelName: string | null
    status: string
    total: number
    createdAt: any
    deliveredAt: any
    items: Array<{ productName: string; quantity: number; unitPrice: number; lineTotal: number }>
    /** true = dựng từ phiếu bán vì bản ghi đơn sàn đã bị dọn */
    tuPhieu: boolean
}

/**
 * DỰNG LẠI ĐƠN TỪ PHIẾU BÁN khi bản ghi OnlineOrder đã bị cron dọn xoá (cron/autoSync runCleanup: đơn kết thúc quá
 * 18 ngày, chỉ xoá khi đã có phiếu — phiếu là sổ gốc, đơn chỉ còn là bản sao). Đo 29/10/2026 KENGISTORE: phiếu
 * ONLINE- trước tháng 10 mất đơn gốc ~99% (tháng 8: 4.003/4.009, trong đó 3.234 phiếu đã xuất HĐĐT) ⇒ khách tra mã
 * đơn cũ hơn ~18 ngày đều bị "không tìm thấy" dù hoá đơn có thật. Phiếu còn thì vẫn tra / tải HĐ / gửi MST được.
 *
 * Trạng thái: cron chỉ xoá đơn đã kết thúc, nên phiếu `completed` ⇒ đã giao; `voided` (đảo do huỷ / hoàn / giao
 * thất bại — xem services/suaPhieuDonDaXoa) ⇒ đã huỷ; `returned` / có returnedAt ⇒ trả hàng. Ngày giao không còn ⇒
 * để trống (trang khách tự ẩn). Sàn lấy từ ghi chú phiếu "Đơn online shopee - …" (orderSync), không có thì theo tiền tố.
 */
export function donTuPhieu(p: PhieuBanDonSan, channelName?: string | null): DonKhach {
    const orderNumber = String(p.receiptNumber || '').replace(/^ONLINE-/, '')
    const st = String(p.status || '').toLowerCase()
    const status = p.returnedAt || /return|hoan/.test(st) ? 'returned' : /void|cancel|huy/.test(st) ? 'cancelled' : 'completed'
    const ghiChu = /^Đơn online\s+(\S+)/i.exec(String(p.notes || ''))
    const platform = ghiChu ? ghiChu[1].toLowerCase() : (KENH_THEO_TIEN_TO[orderNumber.split('-')[0]] || '').toLowerCase() || null
    return {
        orderNumber,
        platform,
        channelName: channelName || null,
        status,
        total: Number(p.total) || 0,
        createdAt: p.transactionDate || p.createdAt || null,
        deliveredAt: null,
        items: (p.items || []).map(i => ({
            productName: String(i.productName || ''), quantity: Number(i.quantity) || 0,
            unitPrice: Number(i.unitPrice) || 0, lineTotal: Number(i.lineTotal) || 0,
        })),
        tuPhieu: true,
    }
}
