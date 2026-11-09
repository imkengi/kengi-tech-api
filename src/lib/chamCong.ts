/**
 * Giờ VÀO / RA của bản ghi chấm công — thân POST /api/attendance (và giờ ra của PUT /api/attendance/:id). 10/11/2026.
 *
 * Sự cố: route chỉ đọc { userId, userName, role, date, note } rồi đặt checkIn = LÚC GỬI, không có checkOut. Trong khi
 * "Chốt ca" của POS web (features/pos/components/CloseShiftModal.tsx) gửi checkIn = đầu ca, checkOut = lúc chốt — và
 * trang Tài liệu API cũng ghi POST nhận checkin/checkout. Mọi bản ghi ca POS vì thế mang giờ vào = giờ CHỐT ca, không
 * có giờ ra (ca dài 0 phút) — chủ shop xem trang Chấm công thấy nhân viên "vào làm" lúc tan ca.
 *
 * Luật:
 *  - Không gửi giờ ⇒ như cũ: vào = bây giờ, chưa ra (nút "Check-in" của trang Chấm công không đổi hành vi).
 *  - Nhận cả `checkIn`/`checkOut` (POS web) lẫn `checkin`/`checkout` (trang Tài liệu API).
 *  - Có gửi mà không đọc được / ra TRƯỚC vào / ở TƯƠNG LAI (quá 5 phút lệch đồng hồ máy khách) ⇒ báo lỗi (400),
 *    KHÔNG lặng lẽ thay bằng "bây giờ" — đó chính là cách bản ghi sai giờ lọt vào sổ.
 *  - `date` (ngày công) mặc định theo GIỜ VÀO: ca bắt đầu 22:00 hôm trước thì tính cho hôm trước.
 */
export const LECH_DONG_HO_MS = 5 * 60_000

export type GioCa = { checkIn: Date; checkOut: Date | null; date: Date }
export type LoiGio = { loi: string }

/** Một thời điểm từ thân yêu cầu: không gửi ⇒ null; gửi mà hỏng ⇒ { loi }. */
export function docThoiDiem(v: unknown, ten: string): Date | null | LoiGio {
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'string' && typeof v !== 'number') return { loi: `${ten} phải là thời điểm ISO 8601` }
    const d = new Date(v)
    if (isNaN(d.getTime())) return { loi: `${ten} không phải thời điểm hợp lệ: "${String(v).slice(0, 40)}"` }
    return d
}

const laLoi = (x: unknown): x is LoiGio => !!x && typeof x === 'object' && !(x instanceof Date) && 'loi' in (x as object)

/** Giờ vào / ra / ngày công cho bản ghi MỚI (POST). */
export function docGioCa(body: any, now: Date = new Date()): GioCa | LoiGio {
    const b = body && typeof body === 'object' ? body : {}
    const vao = docThoiDiem(b.checkIn ?? b.checkin, 'checkIn')
    if (laLoi(vao)) return vao
    const ra = docThoiDiem(b.checkOut ?? b.checkout, 'checkOut')
    if (laLoi(ra)) return ra
    const ngay = docThoiDiem(b.date, 'date')
    if (laLoi(ngay)) return ngay
    const tran = now.getTime() + LECH_DONG_HO_MS
    if (vao && vao.getTime() > tran) return { loi: 'checkIn ở tương lai — kiểm tra đồng hồ máy gửi' }
    if (ra && ra.getTime() > tran) return { loi: 'checkOut ở tương lai — kiểm tra đồng hồ máy gửi' }
    const gioVao = vao ?? now
    if (ra && ra.getTime() < gioVao.getTime()) return { loi: 'checkOut trước checkIn' }
    return { checkIn: gioVao, checkOut: ra, date: ngay ?? gioVao }
}

/** Giờ ra gửi lên khi CẬP NHẬT (PUT): không gửi ⇒ null; hỏng / ở tương lai ⇒ { loi }. */
export function docGioRa(body: any, now: Date = new Date()): Date | null | LoiGio {
    const b = body && typeof body === 'object' ? body : {}
    const ra = docThoiDiem(b.checkOut ?? b.checkout, 'checkOut')
    if (laLoi(ra)) return ra
    if (ra && ra.getTime() > now.getTime() + LECH_DONG_HO_MS) return { loi: 'checkOut ở tương lai — kiểm tra đồng hồ máy gửi' }
    return ra
}

export { laLoi as laLoiGio }
