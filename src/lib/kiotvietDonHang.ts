/**
 * ĐƠN CÓ ĐANG VỀ KHÔNG — câu hỏi mà bảng lịch sử KiotViet KHÔNG trả lời được.
 *
 * Ngày 15/08/2026 HUTI mất đơn cả ngày. Nhật ký lúc đó vẫn chạy rào rào và
 * toàn `success`, vì 89/100 dòng gần nhất là `customer.update`. Nhìn bảng thấy
 * "xanh hết" nên không ai nghi gì — trong khi KiotViet đã tự tắt webhook hoá
 * đơn từ hôm trước. Đếm dòng không phát hiện được: phải hỏi riêng HOÁ ĐƠN.
 *
 * Dấu hiệu sớm quan trọng nhất KHÔNG phải là "lâu rồi không có hoá đơn", mà là
 * "hoá đơn chỉ về khi có người bấm tay" — đó đúng là trạng thái 14/08: bấm tay
 * lúc 08:22 nên ngày đó có đơn, hôm sau không ai bấm là trắng sổ. Chờ đủ 24h
 * mới kêu thì đã mất trọn một ngày doanh thu.
 *
 * Bốn mức, cố ý tách 'nhac' khỏi báo động để KHÔNG KÊU OAN: cửa hàng vừa nối
 * KiotViet cũng chưa từng có hoá đơn qua webhook, mà đó không phải lỗi.
 */

export type MucDonHang = 'on' | 'nhac' | 'vua' | 'nang'

export interface TinhTrangDon {
    muc: MucDonHang
    loi: string | null
    lanCuoi: string | null
    kieuLanCuoi: string | null
    soDonLanCuoi: number | null
    soGio: number | null
    webhookGanNhat: string | null
    soDongDaSoi: number
}

/**
 * Dòng nhật ký hoá đơn: `invoices` là bấm tay, `invoice.*` là webhook dội về.
 *
 * PHẢI TÁCH DẤU PHẨY. Nút "đồng bộ tất cả" ghi entity thành một chuỗi gộp
 * `products,customers,suppliers,invoices,returns,purchaseOrders,cashflow`
 * (có thật trong log HUTI). So bằng `=== 'invoices'` là trượt hết, và cửa
 * hàng nào chỉ dùng nút tổng sẽ bị vu là "chưa từng đồng bộ hoá đơn".
 */
export const laHoaDon = (e: string) =>
    String(e || '').split(',').some(t => {
        const s = t.trim()
        return s === 'invoices' || s.startsWith('invoice.')
    })

const quaWebhook = (r: any) => String(r?.entity || '').startsWith('invoice.')

/**
 * @param logs  các dòng kiotVietSyncLog, MỚI NHẤT TRƯỚC
 * @param bayGio mốc thời gian coi là "bây giờ" (để test cố định được)
 */
export function tinhTinhTrangDon(logs: any[], bayGio: number = Date.now()): TinhTrangDon | null {
    if (!logs.length) return null      // chưa đồng bộ bao giờ → im, không bịa

    const moiNhat = logs.find(r => laHoaDon(String(r?.entity || '')))
    const webhookGanNhat = logs.find(quaWebhook)

    const soGio = moiNhat ? (bayGio - new Date(moiNhat.startedAt).getTime()) / 3_600_000 : null

    let muc: MucDonHang = 'on'
    let loi = ''

    if (!moiNhat) {
        muc = 'vua'
        loi = `Chưa thấy lượt đồng bộ hoá đơn nào trong ${logs.length} dòng gần nhất.`
    } else if (soGio! >= 48) {
        muc = 'nang'
        loi = `${Math.floor(soGio! / 24)} ngày rồi không có hoá đơn nào về.`
    } else if (soGio! >= 24) {
        muc = 'vua'
        loi = `${Math.floor(soGio!)} giờ rồi không có hoá đơn nào về.`
    } else if (!webhookGanNhat) {
        // Vừa có hoá đơn, nhưng do BẤM TAY. Chưa chứng minh được webhook còn sống.
        muc = 'nhac'
        loi = 'Hoá đơn đang chỉ về khi bấm đồng bộ tay — chưa lần nào tự về qua webhook.'
    }

    /* Mách nước cho MỌI mức có vấn đề — kể cả khi lượt cuối đến qua webhook.
     * Bản đầu tôi chỉ mách khi lượt cuối là bấm tay, nhưng "từng về qua webhook
     * rồi tắt ngóm" ĐÚNG LÀ kịch bản KiotViet tự tắt; chặn ở đó là giấu lời
     * khuyên đúng vào lúc cần nhất. Mức 'on' đã loại sẵn nên không chỉ sai đường. */
    if (muc !== 'on') {
        loi += ' KiotViet tự tắt webhook sau nhiều lần giao hỏng — bấm "Đăng ký webhook" để bật lại.'
    }

    return {
        muc,
        loi: loi || null,
        lanCuoi: moiNhat?.startedAt || null,
        kieuLanCuoi: moiNhat?.mode || null,          // manual = do người bấm
        soDonLanCuoi: moiNhat?.created ?? null,
        soGio: soGio === null ? null : Math.round(soGio),
        webhookGanNhat: webhookGanNhat?.startedAt || null,
        soDongDaSoi: logs.length,
    }
}
