// ═══════════════════════════════════════════════════════════════════════════════
//  LỊCH CHẠY CHO TRỢ LÝ TỰ ĐỘNG
//  Giờ hẹn của job là GIỜ VIỆT NAM. Cloud Run chạy UTC nên mọi phép tính phải
//  quy đổi tường minh — đây đúng loại lỗi lệch 7 tiếng đã gặp ở lên lịch bài.
// ═══════════════════════════════════════════════════════════════════════════════

const VN_OFFSET_MS = 7 * 60 * 60 * 1000

/** Lời dặn cho agent khi chạy KHÔNG có người ngồi xem. */
export const SYSTEM_PROMPT_TU_DONG =
    'Bạn là trợ lý vận hành cửa hàng bán lẻ Kengi, đang chạy TỰ ĐỘNG theo lịch — KHÔNG có người ngồi xem để hỏi lại. '
    + 'Hãy tự hoàn thành việc được giao bằng các công cụ có sẵn, TUYỆT ĐỐI không bịa số. Tiền tệ VND. '
    + 'Nếu thiếu thông tin hoặc công cụ cần thiết không được cấp quyền, ĐỪNG đoán bừa — hãy nêu rõ đang thiếu gì trong phần trả lời. '
    + 'Nếu một công cụ báo lỗi, thử cách khác hợp lý; không lặp lại y nguyên lệnh vừa hỏng. '
    + 'TRƯỚC KHI kết luận từ bất kỳ báo cáo THEO KỲ nào (doanh thu tháng, lãi lỗ, thuế), hãy gọi data_health_check một lần và nêu rõ mọi mục ở mức "nang" trong báo cáo. Chạy tự động thì không ai kiểm lại giúp, nên một con số trình bày như sự thật đã chắc sẽ đi thẳng vào quyết định của chủ shop. Con số null nghĩa là CHƯA ĐỌC ĐƯỢC, không phải bằng 0. '
    + 'Doanh thu theo kỳ: revenue_by_day cắt theo NGÀY BÁN, còn sales_report/profit_report cắt theo NGÀY GHI SỔ — với cửa hàng nhập lịch sử từ phần mềm cũ thì lệch nhau nhiều lần. Báo cáo doanh thu hay lãi của một tháng thì ưu tiên revenue_by_day, và nếu dùng hai tool kia thì nêu rõ trường canhBaoLechKy. '
    + 'Kết thúc bằng một BÁO CÁO NGẮN bằng tiếng Việt: đã làm gì, số liệu chính, và việc gì cần chủ shop quyết. '
    + 'Báo cáo này được lưu lại để chủ shop đọc sau, nên hãy viết đủ ý và nêu rõ mốc thời gian.'

export type LichJob = {
    scheduleKind: string
    atHour: number
    atMinute: number
    intervalMinutes: number
}

/**
 * Mốc chạy kế tiếp tính từ `moc` (mặc định bây giờ).
 *  - interval: cộng thêm N phút (tối thiểu 5 để không quay cuồng)
 *  - daily:    đúng atHour:atMinute GIỜ VN của ngày kế tiếp chưa qua
 */
export function tinhLanChayKe(job: LichJob, moc: Date = new Date()): Date {
    if (job.scheduleKind === 'interval') {
        const phut = Math.max(Number(job.intervalMinutes) || 60, 5)
        return new Date(moc.getTime() + phut * 60_000)
    }
    // daily — làm việc trên "đồng hồ VN" bằng cách dịch mốc rồi dịch ngược lại
    const gioVN = new Date(moc.getTime() + VN_OFFSET_MS)
    const h = Math.min(Math.max(Number(job.atHour) || 0, 0), 23)
    const m = Math.min(Math.max(Number(job.atMinute) || 0, 0), 59)
    const moiVN = new Date(Date.UTC(
        gioVN.getUTCFullYear(), gioVN.getUTCMonth(), gioVN.getUTCDate(), h, m, 0, 0,
    ))
    // Đã qua giờ hẹn hôm nay → hẹn ngày mai
    if (moiVN.getTime() <= gioVN.getTime()) moiVN.setUTCDate(moiVN.getUTCDate() + 1)
    return new Date(moiVN.getTime() - VN_OFFSET_MS)
}

/** Mô tả lịch bằng tiếng Việt để hiển thị và cho agent đọc. */
export function moTaLich(job: LichJob): string {
    if (job.scheduleKind === 'interval') {
        const p = Math.max(Number(job.intervalMinutes) || 60, 5)
        return p % 60 === 0 ? `mỗi ${p / 60} giờ` : `mỗi ${p} phút`
    }
    const hh = String(Math.min(Math.max(job.atHour, 0), 23)).padStart(2, '0')
    const mm = String(Math.min(Math.max(job.atMinute, 0), 59)).padStart(2, '0')
    return `hằng ngày lúc ${hh}:${mm} (giờ VN)`
}
