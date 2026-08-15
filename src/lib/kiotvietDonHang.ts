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
    tieu: string
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
 * ⚠ HỢP ĐỒNG VỚI NGƯỜI GỌI: `logs` PHẢI được chèn sẵn ba dòng neo, mỗi dòng
 * lấy bằng một truy vấn riêng — KHÔNG được đưa vào mỗi "N dòng gần nhất":
 *   1. dòng hoá đơn gần nhất            (bất kể ghi được gì không)
 *   2. dòng hoá đơn gần nhất qua webhook
 *   3. dòng hoá đơn gần nhất GHI ĐƯỢC phiếu (created + updated > 0)
 *
 * Hàm này chỉ nhìn thấy những gì được đưa vào, nên thiếu neo là nó kết luận
 * sai mà vẫn rất tự tin. Đo thật 15/08/2026 lúc 10:01: webhook hoá đơn dội về
 * dày tới mức 100 dòng gần nhất chỉ phủ 12 PHÚT — lượt bấm tay ghi 22 phiếu
 * lúc 09:26 rơi ra ngoài, và bản thiếu neo đã kêu oan "48h qua chưa phiếu nào
 * vào sổ" trong khi vừa ghi 22 phiếu nửa tiếng trước.
 *
 * @param logs  các dòng kiotVietSyncLog, MỚI NHẤT TRƯỚC, đã chèn ba dòng neo
 * @param bayGio mốc thời gian coi là "bây giờ" (để test cố định được)
 */
export function tinhTinhTrangDon(logs: any[], bayGio: number = Date.now()): TinhTrangDon | null {
    if (!logs.length) return null      // chưa đồng bộ bao giờ → im, không bịa

    const moiNhat = logs.find(r => laHoaDon(String(r?.entity || '')))
    const webhookGanNhat = logs.find(quaWebhook)
    /* Lượt hoá đơn gần nhất THẬT SỰ ghi được phiếu vào sổ. "Dội về" và "vào
     * sổ" là hai chuyện khác nhau — xem nhánh dùng biến này ở dưới. */
    const ghiGanNhat = logs.find(r =>
        laHoaDon(String(r?.entity || '')) && (Number(r?.created) || 0) + (Number(r?.updated) || 0) > 0)

    const soGio = moiNhat ? (bayGio - new Date(moiNhat.startedAt).getTime()) / 3_600_000 : null

    let muc: MucDonHang = 'on'
    let loi = ''
    /* Tiêu đề đi kèm LÝ DO chứ không đi theo mức. Mức 'nhac' có hai bệnh khác
     * hẳn nhau (phải bấm tay / về mà không vào sổ); để giao diện tự đoán tiêu
     * đề theo mức là chắc chắn có lúc gắn nhãn sai bệnh. */
    let tieu = 'Đơn đang tự về'
    let machBatWebhook = true

    if (!moiNhat) {
        muc = 'vua'
        tieu = 'Chưa từng đồng bộ hoá đơn'
        loi = `Chưa thấy lượt đồng bộ hoá đơn nào trong ${logs.length} dòng gần nhất.`
    } else if (soGio! >= 48) {
        muc = 'nang'
        tieu = 'Đơn đã ngừng về'
        loi = `${Math.floor(soGio! / 24)} ngày rồi không có hoá đơn nào về.`
    } else if (soGio! >= 24) {
        muc = 'vua'
        tieu = 'Lâu rồi không có đơn nào về'
        loi = `${Math.floor(soGio!)} giờ rồi không có hoá đơn nào về.`
    } else if (!webhookGanNhat) {
        tieu = 'Đơn về được, nhưng phải bấm tay'
        // Vừa có hoá đơn, nhưng do BẤM TAY. Chưa chứng minh được webhook còn sống.
        muc = 'nhac'
        loi = 'Hoá đơn đang chỉ về khi bấm đồng bộ tay — chưa lần nào tự về qua webhook.'
    } else if (!ghiGanNhat || (bayGio - new Date(ghiGanNhat.startedAt).getTime()) / 3_600_000 >= 48) {
        /* ỐNG THÔNG NHƯNG KHÔNG CÓ NƯỚC CHẢY.
         * Webhook dội về đều mà KHÔNG phiếu nào vào sổ thì đơn vẫn không về —
         * chấm "on" ở đây là dựng lại đúng cái bẫy chuông này sinh ra để chặn,
         * chỉ dịch lên một tầng. Repo từng dính 08/08/2026: invoice.update vào
         * mà ghi 0, chỉ thấy "lấy 1 · tạo 0".
         * Bình thường vẫn có lúc ghi 0 (đơn Shopee còn Processing, phiếu đã
         * huỷ) nên KHÔNG kêu ngay — chờ hết 48h không ghi được gì mới nhắc,
         * và chỉ ở mức 'nhac' vì cửa hàng vắng khách cũng ra hình này. */
        muc = 'nhac'
        tieu = 'Webhook về được nhưng không phiếu nào vào sổ'
        loi = 'Webhook hoá đơn vẫn dội về nhưng 48 giờ qua chưa phiếu nào vào sổ — mở lịch sử xem lý do bỏ qua.'
        machBatWebhook = false      // webhook đang chạy tốt, xem ghi chú dưới
    }

    /* Mách nước cho mọi mức có vấn đề VỀ ĐƯỜNG TRUYỀN — kể cả khi lượt cuối đến
     * qua webhook, vì "từng về qua webhook rồi tắt ngóm" ĐÚNG LÀ kịch bản
     * KiotViet tự tắt.
     *
     * TRỪ nhánh "về được nhưng không vào sổ": ở đó webhook đang chạy ngon,
     * bệnh nằm ở khâu ghi. Bảo người dùng đi đăng ký lại webhook là chỉ sai
     * đường — họ bấm xong vẫn y nguyên rồi mất lòng tin vào cảnh báo. */
    if (muc !== 'on' && machBatWebhook) {
        loi += ' KiotViet tự tắt webhook sau nhiều lần giao hỏng — bấm "Đăng ký webhook" để bật lại.'
    }

    return {
        muc,
        tieu,
        loi: loi || null,
        lanCuoi: moiNhat?.startedAt || null,
        kieuLanCuoi: moiNhat?.mode || null,          // manual = do người bấm
        soDonLanCuoi: moiNhat?.created ?? null,
        soGio: soGio === null ? null : Math.round(soGio),
        webhookGanNhat: webhookGanNhat?.startedAt || null,
        soDongDaSoi: logs.length,
    }
}
