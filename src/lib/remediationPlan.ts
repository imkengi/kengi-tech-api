/**
 * KẾ HOẠCH KHẮC PHỤC TRƯỚC THANH TRA — hàm thuần, KHÔNG chạm cơ sở dữ liệu.
 *
 * Ba module trước trả lời "sai chỗ nào", "họ hỏi gì", "mất bao nhiêu nếu bị ấn
 * định". Còn thiếu đúng câu quan trọng nhất với người làm: **giờ tôi phải làm
 * gì, theo thứ tự nào, trước ngày nào, và ai làm**.
 *
 * File này gom phát hiện của các module kia thành một danh sách việc có:
 *  - thứ tự ưu tiên theo TIỀN/CÔNG SỨC (việc nhiều tiền mà làm nhanh lên trước),
 *  - hạn chót tính từ hạn nộp tờ khai thật của kỳ, không phải hạn tự bịa,
 *  - người chịu trách nhiệm, vì "để đó rồi ai đó làm" nghĩa là không ai làm.
 *
 * Nhận đầu vào là kết quả đã tính sẵn thay vì tự truy vấn — vừa dễ kiểm chứng,
 * vừa không quét lại cơ sở dữ liệu lần thứ ba.
 */

import type { HoSoThue, CanhBaoThue } from './taxAudit'
import type { HoSoAnDinh, CanCuAnDinh } from './taxAssessment'

export type UuTien = 1 | 2 | 3
export type CongSuc = 'nhanh' | 'trung-binh' | 'lau'
export type NguoiLam = 'ke-toan' | 'chu-cua-hang' | 'thu-kho' | 'thu-ngan'

export interface ViecKhacPhuc {
    ma: string
    tieuDe: string
    /** Việc phải làm, viết ở dạng mệnh lệnh cụ thể */
    viecLam: string
    vaSao: string
    uuTien: UuTien
    /** Hạn chót dạng YYYY-MM-DD */
    hanChot: string
    soNgayConLai: number
    quaHan: boolean
    /** Tiền tiết kiệm được / tránh bị truy thu, null nếu không lượng hóa được */
    tienLoiIch: number | null
    congSuc: CongSuc
    aiLam: NguoiLam
    canCu: string
    nguon: 'soat-du-lieu' | 'nguy-co-an-dinh' | 'ho-so-giay'
}

export interface KeHoachKhacPhuc {
    ky: string
    hanNopToKhai: string
    viec: ViecKhacPhuc[]
    soViecLamNgay: number
    soViecQuaHan: number
    tongTienLoiIch: number
    /** Một câu tóm tắt để hiện ở đầu trang, không phải đọc hết danh sách */
    tomTat: string
    ghiChu: string
}

const NGUOI_TEN: Record<NguoiLam, string> = {
    'ke-toan': 'Kế toán',
    'chu-cua-hang': 'Chủ cửa hàng',
    'thu-kho': 'Thủ kho',
    'thu-ngan': 'Thu ngân / quầy bán',
}
export const TEN_NGUOI_LAM = NGUOI_TEN

const CONG_SUC_DIEM: Record<CongSuc, number> = { 'nhanh': 1, 'trung-binh': 2, 'lau': 3 }

/**
 * Ai làm và mất bao nhiêu công cho từng loại phát hiện.
 * Tách thành bảng riêng để sửa một chỗ khi thực tế vận hành khác đi, thay vì
 * rải if/else khắp nơi.
 */
const PHAN_CONG: Record<string, { aiLam: NguoiLam; congSuc: CongSuc }> = {
    'dt-so-vs-tokhai': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'dt-so-vs-hoadon': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'vat-ra-lech': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'vat-vao-lech': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'vat-sai-so-hoc': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'vat-khong-nhat-quan': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'vat-vao-ton-dong': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'thieu-to-khai': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'to-khai-tre-han': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'to-khai-tre-han-uoc': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    /* Việc này là ĐỐI CHIẾU giấy đăng ký kinh doanh chứ không phải nộp tờ khai,
     * nên giao cho chủ cửa hàng — kế toán không cầm giấy tờ pháp lý đó. */
    'to-khai-tre-han-truoc-khi-dung': { aiLam: 'chu-cua-hang', congSuc: 'nhanh' },
    'hoa-don-nhay-so': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'hoa-don-trung-so': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'hoa-don-lui-ngay': { aiLam: 'thu-ngan', congSuc: 'nhanh' },
    'hoadon-huy-nhieu': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'hoa-don-ra-thieu-mst-mua': { aiLam: 'thu-ngan', congSuc: 'nhanh' },
    'hoa-don-vao-thieu-thong-tin': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'hoa-don-vao-trung': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'chi-khong-hoa-don': { aiLam: 'chu-cua-hang', congSuc: 'lau' },
    'nhap-khong-hoa-don': { aiLam: 'chu-cua-hang', congSuc: 'lau' },
    'nhap-tra-tien-mat': { aiLam: 'chu-cua-hang', congSuc: 'nhanh' },
    'tien-mat-vuot-nguong': { aiLam: 'chu-cua-hang', congSuc: 'nhanh' },
    'tien-mat-ty-trong-cao': { aiLam: 'chu-cua-hang', congSuc: 'trung-binh' },
    'ton-kho-am': { aiLam: 'thu-kho', congSuc: 'trung-binh' },
    'hao-hut-vuot-muc': { aiLam: 'thu-kho', congSuc: 'trung-binh' },
    'ban-duoi-gia-von': { aiLam: 'chu-cua-hang', congSuc: 'nhanh' },
    'ban-vuot-hoa-don-vao': { aiLam: 'chu-cua-hang', congSuc: 'lau' },
    'hang-tang-gia-0': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'quy-am-trong-ky': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'tien-vao-vuot-doanh-thu': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'thieu-bang-luong': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'tncn-thieu-khau-tru': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'tncn-thieu-mst': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'mst-sai-dinh-dang': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'mua-cua-chinh-minh': { aiLam: 'ke-toan', congSuc: 'nhanh' },
    'cut-off-doanh-thu': { aiLam: 'ke-toan', congSuc: 'trung-binh' },
    'hkd-vuot-nguong-chiu-thue': { aiLam: 'chu-cua-hang', congSuc: 'trung-binh' },
    'hkd-phai-ket-noi-pos': { aiLam: 'chu-cua-hang', congSuc: 'lau' },
}
const PHAN_CONG_MAC_DINH = { aiLam: 'ke-toan' as NguoiLam, congSuc: 'trung-binh' as CongSuc }

const p2 = (n: number) => String(n).padStart(2, '0')

/**
 * Hạn nộp hồ sơ khai thuế của kỳ — Điều 44 Luật Quản lý thuế 38/2019.
 * Tháng: ngày 20 của tháng sau. Quý: ngày cuối tháng đầu quý sau.
 * Năm (quyết toán): ngày cuối tháng thứ 3 kể từ khi kết thúc năm.
 */
export function hanNopToKhai(maKy: string): string {
    const nam = Number(maKy.slice(0, 4))
    if (/^\d{4}-Q[1-4]$/.test(maKy)) {
        const quy = Number(maKy.slice(6))
        const thang = quy * 3 + 1
        const y = thang > 12 ? nam + 1 : nam
        const m = thang > 12 ? thang - 12 : thang
        return `${y}-${p2(m)}-${p2(new Date(y, m, 0).getDate())}`
    }
    if (/^\d{4}-\d{2}$/.test(maKy)) {
        const thang = Number(maKy.slice(5, 7)) + 1
        const y = thang > 12 ? nam + 1 : nam
        const m = thang > 12 ? thang - 12 : thang
        return `${y}-${p2(m)}-20`
    }
    return `${nam + 1}-03-31`
}

const ngayISO = (d: Date) => d.toISOString().slice(0, 10)
const themNgay = (goc: string, soNgay: number) =>
    ngayISO(new Date(new Date(goc + 'T00:00:00.000Z').getTime() + soNgay * 86400_000))
const cachNhau = (tu: string, den: string) =>
    Math.round((new Date(den + 'T00:00:00.000Z').getTime() - new Date(tu + 'T00:00:00.000Z').getTime()) / 86400_000)

/** Việc gắn với tờ khai phải xong trước hạn nộp; việc còn lại cho 30 ngày */
const HAN_THEO_TO_KHAI = new Set([
    'dt-so-vs-tokhai', 'vat-ra-lech', 'vat-vao-lech', 'vat-sai-so-hoc',
    'thieu-to-khai', 'to-khai-tre-han', 'to-khai-tre-han-uoc', 'cut-off-doanh-thu',
])

export function lapKeHoachKhacPhuc(
    hoSo: HoSoThue,
    anDinh: HoSoAnDinh | null,
    ky: { maKy: string; nhan: string },
    homNay: string,
): KeHoachKhacPhuc {
    const han = hanNopToKhai(ky.maKy)
    const viec: ViecKhacPhuc[] = []

    const themViec = (v: Omit<ViecKhacPhuc, 'soNgayConLai' | 'quaHan'>) => {
        const soNgayConLai = cachNhau(homNay, v.hanChot)
        viec.push({ ...v, soNgayConLai, quaHan: soNgayConLai < 0 })
    }

    // ── Từ các cảnh báo soát dữ liệu ─────────────────────────────────────────
    for (const c of hoSo.canhBao as CanhBaoThue[]) {
        const pc = PHAN_CONG[c.code] || PHAN_CONG_MAC_DINH
        /* Ưu tiên 1 dành cho mức "cao" — đó là nhóm có nguy cơ thành tiền truy
         * thu thật. Mức "vừa" xuống 2, "thấp" xuống 3, trừ khi số tiền lớn thì
         * kéo lên: 50 triệu rủi ro không thể xếp cùng hạng với việc ghi chú. */
        let uuTien: UuTien = c.muc === 'cao' ? 1 : c.muc === 'vua' ? 2 : 3
        if (uuTien > 1 && (c.tienRuiRo || 0) >= 50_000_000) uuTien = 1

        themViec({
            ma: `soat-${c.code}`,
            tieuDe: c.tieuDe,
            viecLam: c.canLam,
            vaSao: c.chiTiet,
            uuTien,
            hanChot: HAN_THEO_TO_KHAI.has(c.code) ? han : themNgay(homNay, 30),
            tienLoiIch: c.tienRuiRo,
            congSuc: pc.congSuc,
            aiLam: pc.aiLam,
            canCu: c.canCu,
            nguon: 'soat-du-lieu',
        })
    }

    // ── Từ căn cứ ấn định ────────────────────────────────────────────────────
    /* Có cảnh báo trùng nội dung với căn cứ ấn định (tồn kho âm, quỹ âm…).
     * Không thêm việc trùng — người đọc thấy hai dòng gần giống nhau sẽ mất tin
     * vào cả danh sách. Chỉ NÂNG ưu tiên việc đã có lên mức 1. */
    const TRUNG: Record<string, string> = {
        'ton-kho-am': 'soat-ton-kho-am',
        'quy-am': 'soat-quy-am-trong-ky',
        'so-lieu-khong-trung-thuc': 'soat-dt-so-vs-tokhai',
        'khong-nop-to-khai': 'soat-thieu-to-khai',
        'mua-vao-khong-hoa-don': 'soat-nhap-khong-hoa-don',
    }
    for (const cc of (anDinh?.canCu || []) as CanCuAnDinh[]) {
        const maTrung = TRUNG[cc.ma]
        const daCo = maTrung ? viec.find(v => v.ma === maTrung) : undefined
        if (daCo) {
            if (cc.muc === 'ro-rang') daCo.uuTien = 1
            daCo.vaSao += ` Đây còn là căn cứ để cơ quan thuế ẤN ĐỊNH thuế (${cc.dieuKhoan}).`
            continue
        }
        themViec({
            ma: `andinh-${cc.ma}`,
            tieuDe: `Xóa căn cứ ấn định: ${cc.dauHieu}`,
            viecLam: cc.caiThenao,
            vaSao: cc.chiTiet,
            uuTien: cc.muc === 'ro-rang' ? 1 : 2,
            hanChot: han,
            tienLoiIch: null,
            congSuc: 'trung-binh',
            aiLam: 'ke-toan',
            canCu: cc.dieuKhoan,
            nguon: 'nguy-co-an-dinh',
        })
    }

    // ── Hồ sơ giấy phần mềm không thay thế được ──────────────────────────────
    /* Những thứ này không có "dấu hiệu sai" nào để phát hiện — chúng chỉ đơn
     * giản là KHÔNG TỒN TẠI cho tới khi ai đó ngồi lập. Không đưa vào kế hoạch
     * thì tới ngày đoàn hỏi mới biết mình chưa có. */
    const hoSoGiay: Array<{ ma: string; ten: string; viec: string; ai: NguoiLam; congSuc: CongSuc }> = [
        {
            ma: 'kiem-ke-kho', ten: 'Biên bản kiểm kê kho cuối kỳ',
            viec: 'Kiểm kê thực tế, lập biên bản có chữ ký người kiểm kê và đối chiếu với tồn trên sổ.',
            ai: 'thu-kho', congSuc: 'trung-binh',
        },
        {
            ma: 'kiem-ke-quy', ten: 'Biên bản kiểm kê quỹ tiền mặt cuối kỳ',
            viec: 'Đếm tiền mặt thực tế, lập biên bản kiểm kê quỹ có chữ ký thủ quỹ và người chứng kiến.',
            ai: 'ke-toan', congSuc: 'nhanh',
        },
        {
            ma: 'doi-chieu-ngan-hang', ten: 'Sao kê ngân hàng cả kỳ',
            viec: 'Xin sao kê có dấu của ngân hàng và đối chiếu từng khoản với sổ tiền gửi.',
            ai: 'ke-toan', congSuc: 'nhanh',
        },
    ]
    for (const h of hoSoGiay) {
        themViec({
            ma: `hoso-${h.ma}`,
            tieuDe: h.ten,
            viecLam: h.viec,
            vaSao: 'Đoàn thanh tra luôn yêu cầu chứng từ này và phần mềm không thay thế được bản có chữ ký.',
            uuTien: 3,
            hanChot: themNgay(han, 15),
            tienLoiIch: null,
            congSuc: h.congSuc,
            aiLam: h.ai,
            canCu: 'Điều 20 Luật Kế toán 88/2015; Thông tư 133/2016/TT-BTC',
            nguon: 'ho-so-giay',
        })
    }

    /* Sắp xếp: ưu tiên → quá hạn trước → nhiều tiền trước → làm nhanh trước.
     * Việc nhiều tiền mà làm nhanh phải nằm trên cùng: đó là chỗ bỏ một buổi ra
     * làm là thu về nhiều nhất. */
    viec.sort((a, b) =>
        a.uuTien - b.uuTien ||
        Number(b.quaHan) - Number(a.quaHan) ||
        (b.tienLoiIch || 0) - (a.tienLoiIch || 0) ||
        CONG_SUC_DIEM[a.congSuc] - CONG_SUC_DIEM[b.congSuc])

    const soViecLamNgay = viec.filter(v => v.uuTien === 1).length
    const soViecQuaHan = viec.filter(v => v.quaHan).length
    const tongTienLoiIch = viec.reduce((s, v) => s + (v.tienLoiIch || 0), 0)

    const tomTat = soViecLamNgay === 0
        ? `Kỳ ${ky.nhan}: không có việc nào phải làm gấp, còn ${viec.length} việc nên hoàn tất trước khi đoàn tới.`
        : `Kỳ ${ky.nhan}: ${soViecLamNgay} việc phải làm ngay` +
        (tongTienLoiIch > 0 ? `, liên quan ${Math.round(tongTienLoiIch).toLocaleString('vi-VN')}đ tiền thuế có nguy cơ` : '') +
        (soViecQuaHan > 0 ? `; trong đó ${soViecQuaHan} việc ĐÃ QUÁ HẠN.` : '.')

    return {
        ky: ky.nhan,
        hanNopToKhai: han,
        viec,
        soViecLamNgay,
        soViecQuaHan,
        tongTienLoiIch: Math.round(tongTienLoiIch),
        tomTat,
        ghiChu: 'Hạn chót ở đây tính theo hạn nộp hồ sơ khai thuế của kỳ (Điều 44 Luật Quản lý thuế 38/2019) và mốc 30 ngày cho việc thu thập chứng từ. Việc khai bổ sung chỉ được hưởng mức nhẹ nếu làm TRƯỚC khi cơ quan thuế công bố quyết định thanh tra.',
    }
}
