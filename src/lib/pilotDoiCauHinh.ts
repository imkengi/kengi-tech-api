/**
 * SỔ ĐỔI CẤU HÌNH PILOT (X-14, 10/11/2026)
 *
 * Trước: đổi chế độ (Xem trước ⇄ Tự động), trần ghi / ngày, biên lãi, lịch chạy, trần ngân sách quảng cáo… chỉ để lại dòng
 * AuditLog chung "ai POST /…-pilot/config lúc nào" (middleware) — KHÔNG ghi đổi GÌ. Chủ shop không trả lời được "ai bật Tự động",
 * "ai nâng trần ngân sách quảng cáo" khi tiền thật đã chi / giá thật đã đổi.
 *
 * Giờ mỗi lần lưu cấu hình CÓ thay đổi ⇒ MỘT dòng trong sổ ghi của chính Pilot đó: action 'config', payload
 * { actor, thayDoi: [{ truong, cu, moi }], tomTat } — hiện cùng nhật ký trên trang Pilot (người đổi + câu tóm tắt).
 * Dòng 'config' KHÔNG phải lệnh ghi lên sàn / Facebook ⇒ demGhiTuLuc của cả 4 kho loại ra: trần ghi / ngày chỉ đếm lệnh ghi thật.
 * Lưu y nguyên (không đổi gì) ⇒ không ghi dòng nào.
 */

export interface ThayDoiCauHinh { truong: string; cu: unknown; moi: unknown }

/** cách đọc giá trị: tyLe = phân số (0,15 → 15%), phanTram = đã là % (20 → 20%), dong = tiền, bat = công tắc, gio = khung giờ… */
export type KieuTruong = 'tyLe' | 'phanTram' | 'dong' | 'so' | 'phut' | 'gio' | 'bat' | 'chu' | 'ds' | 'cheDo'
/** đường dẫn chấm (vd. 'policy.automation.reprice') → [nhãn đúng như ô trên trang, kiểu đọc]. Thứ tự = thứ tự trong câu tóm tắt. */
export type NhanCauHinh = Record<string, readonly [string, KieuTruong]>

/** trạng thái máy tự ghi (lượt kế, kết quả lượt, con trỏ lô…) — không phải người chỉnh */
const TRUONG_MAY = /(^|\.)(updatedAt|nextRunAt|lastRunAt|lastResult|conTro|profiles)(\.|$)/

function phang(x: unknown, tien: string, ra: Record<string, unknown>): Record<string, unknown> {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
        for (const [k, v] of Object.entries(x as Record<string, unknown>)) phang(v, tien ? `${tien}.${k}` : k, ra)
    } else if (tien) ra[tien] = x
    return ra
}

function giongNhau(a: unknown, b: unknown): boolean {
    // 0,15 đã lưu ↔ 15 / 100 trang gửi lại: so có dung sai, kẻo lần lưu y nguyên cũng ra dòng "đổi"
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
    // công tắc vắng mặt = tắt (lịch Shopee chỉ lưu allChannels khi bật)
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b
    return (a ?? null) === (b ?? null)
}

/** So phần NGƯỜI chỉnh của hai cấu hình. Trường có nhãn xếp theo thứ tự nhãn, trường lạ (chính sách mới chưa có nhãn) xếp sau. */
export function soCauHinh(cu: Record<string, unknown>, moi: Record<string, unknown>, nhan: NhanCauHinh = {}): ThayDoiCauHinh[] {
    const a = phang(cu, '', {}), b = phang(moi, '', {})
    const thuTu = Object.keys(nhan)
    const hang = (k: string) => { const i = thuTu.indexOf(k); return i < 0 ? thuTu.length : i }
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter(k => !TRUONG_MAY.test(k) && !giongNhau(a[k], b[k]))
        .sort((x, y) => hang(x) - hang(y) || x.localeCompare(y))
        .map(k => ({ truong: k, cu: a[k] ?? null, moi: b[k] ?? null }))
}

const CHE_DO: Record<string, string> = { preview: 'Xem trước', approve: 'Duyệt tay', auto: 'Tự động' }
const soVN = (v: number) => (Math.round(v * 100) / 100).toLocaleString('vi-VN')

export function docGiaTri(v: unknown, kieu: KieuTruong): string {
    if (kieu === 'bat') return v ? 'bật' : 'tắt'
    if (kieu === 'gio') return Array.isArray(v) && v.length ? v.map(h => `${h}h`).join(', ') : 'mặc định'
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return 'trống'
    const n = Number(v)
    switch (kieu) {
        case 'tyLe': return Number.isFinite(n) ? `${soVN(n * 100)}%` : String(v)
        case 'phanTram': return Number.isFinite(n) ? `${soVN(n)}%` : String(v)
        case 'dong': return Number.isFinite(n) ? `${Math.round(n).toLocaleString('vi-VN')}đ` : String(v)
        case 'phut': return Number.isFinite(n) ? `${soVN(n)} phút` : String(v)
        case 'so': return Number.isFinite(n) ? soVN(n) : String(v)
        case 'cheDo': return CHE_DO[String(v)] || String(v)
        case 'ds': return Array.isArray(v) ? v.join(' ') : String(v)
        default: return typeof v === 'object' ? JSON.stringify(v) : String(v)
    }
}

/** "Chế độ thực thi: Xem trước → Tự động; Thao tác ghi mỗi ngày: 50 → 200" — tối đa 1.000 ký tự */
export function tomTatDoiCauHinh(ds: ThayDoiCauHinh[], nhan: NhanCauHinh = {}, docRieng: Record<string, (v: unknown) => string> = {}): string {
    const doc = (k: string, v: unknown) => {
        if (docRieng[k] && v !== null && v !== undefined && v !== '') return docRieng[k](v)
        return docGiaTri(v, nhan[k]?.[1] || (typeof v === 'boolean' ? 'bat' : typeof v === 'number' ? 'so' : 'chu'))
    }
    return ds.map(d => `${nhan[d.truong]?.[0] || d.truong}: ${doc(d.truong, d.cu)} → ${doc(d.truong, d.moi)}`).join('; ').slice(0, 1000)
}

/**
 * Lưu cấu hình XONG thì gọi: có thay đổi ⇒ ghi một dòng sổ 'config'. Ghi sổ hỏng không làm hỏng lần lưu (cấu hình đã lưu — báo
 * lỗi lúc này là nói sai với người bấm), nhưng để lại dấu trên log máy chủ, không nuốt im.
 */
export async function ghiDoiCauHinh(
    kho: { ghiNhatKy(w: { action: string; status: string; planId: string | null; payload: any; response: any }): Promise<void> },
    o: { nguoi?: string | null; cu: Record<string, unknown>; moi: Record<string, unknown>; nhan: NhanCauHinh; docRieng?: Record<string, (v: unknown) => string> },
): Promise<ThayDoiCauHinh[]> {
    const ds = soCauHinh(o.cu, o.moi, o.nhan)
    if (!ds.length) return ds
    const tomTat = tomTatDoiCauHinh(ds, o.nhan, o.docRieng)
    try {
        await kho.ghiNhatKy({ action: 'config', status: 'succeeded', planId: null, payload: { actor: o.nguoi ?? null, thayDoi: ds, tomTat }, response: null })
    } catch (e: any) {
        console.error(`[Pilot] ghi sổ đổi cấu hình hỏng (${o.nguoi || '?'}: ${tomTat.slice(0, 300)}):`, e?.message || e)
    }
    return ds
}

// ─── Nhãn từng Pilot — đúng chữ trên hộp "Chính sách" của trang ────────────────────────────────

const LICH = {
    'schedule.enabled': ['Chạy theo lịch trên máy chủ', 'bat'],
    'schedule.intervalMinutes': ['Chạy theo lịch mỗi', 'phut'],
} as const

const GIA_CHUNG = {
    'policy.maxWritesPerDay': ['Thao tác ghi mỗi ngày', 'so'],
    'policy.targetMarginRate': ['Lãi mục tiêu', 'tyLe'],
    'policy.minMarginRate': ['Biên tối thiểu — giá sàn', 'tyLe'],
    'policy.maxPriceChangeRate': ['Đổi giá tối đa mỗi lần', 'tyLe'],
    'policy.priceStep': ['Làm tròn giá', 'dong'],
    'policy.packagingCost': ['Đóng gói mỗi đơn', 'dong'],
    'policy.adsRate': ['Quảng cáo / voucher', 'tyLe'],
    'policy.affiliateRate': ['Hoa hồng affiliate', 'tyLe'],
    'policy.vatRate': ['Thuế GTGT trên giá bán', 'tyLe'],
} as const

export const NHAN_SHOPEE: NhanCauHinh = {
    executionMode: ['Chế độ thực thi', 'cheDo'],
    channelId: ['Gian Shopee Pilot quản', 'chu'],
    ...LICH,
    'schedule.allChannels': ['Lịch chạy cho cả các gian', 'bat'],
    'policy.automation.reprice': ['Tự điều chỉnh giá bán', 'bat'],
    'policy.automation.syncStock': ['Tự đồng bộ tồn kho', 'bat'],
    'policy.automation.publishNewProducts': ['Tự đăng hàng mới có hồ sơ', 'bat'],
    'policy.automation.campaign.enabled': ['Nhắc tạo chương trình giảm giá', 'bat'],
    ...GIA_CHUNG,
    'policy.maxDiscountRate': ['Giảm khuyến mãi tối đa', 'tyLe'],
    'policy.maxCampaignDays': ['Chương trình dài tối đa (ngày)', 'so'],
    'policy.promotionCooldownHoursAfterIncrease': ['Chờ sau khi tăng giá (giờ)', 'so'],
    'policy.maxPublishPerCycle': ['Tự đăng tối đa mỗi chu kỳ', 'so'],
}

export const NHAN_TIKTOK: NhanCauHinh = {
    executionMode: ['Chế độ thực thi', 'cheDo'],
    channelId: ['Gian TikTok Pilot quản', 'chu'],
    ...LICH,
    'policy.automation.reprice': ['Tự điều chỉnh giá bán', 'bat'],
    'policy.automation.syncStock': ['Tự đẩy tồn kho', 'bat'],
    ...GIA_CHUNG,
    'policy.maxRepricePerCycle': ['Đổi giá tối đa mỗi chu kỳ (sản phẩm)', 'so'],
}

export const NHAN_FACEBOOK: NhanCauHinh = {
    executionMode: ['Chế độ thực thi', 'cheDo'],
    pageId: ['Fanpage Pilot quản', 'chu'],
    ...LICH,
    'policy.automation.posts': ['Tự lên bài sản phẩm', 'bat'],
    'policy.automation.replyPriceQuestions': ['Tự trả lời câu hỏi giá', 'bat'],
    'policy.automation.hidePhoneComments': ['Tự ẩn bình luận lộ số điện thoại', 'bat'],
    'policy.maxWritesPerDay': ['Thao tác ghi mỗi ngày', 'so'],
    'policy.postsPerDay': ['Bài sản phẩm mỗi ngày', 'so'],
    'policy.postHours': ['Khung giờ đăng', 'gio'],
    'policy.minGapMinutes': ['Hai bài cách nhau tối thiểu', 'phut'],
    'policy.repostAfterDays': ['Không lên lại cùng mã trong (ngày)', 'so'],
    'policy.minStock': ['Chỉ lên hàng tồn từ', 'so'],
    'policy.maxImages': ['Ảnh mỗi bài', 'so'],
    'policy.showPrice': ['Ghi giá bán vào bài', 'bat'],
    'policy.cta': ['Câu kêu gọi cuối bài', 'chu'],
    'policy.hashtags': ['Hashtag', 'ds'],
    'policy.maxRepliesPerCycle': ['Trả lời tối đa mỗi chu kỳ', 'so'],
}

export const NHAN_ADS: NhanCauHinh = {
    mode: ['Chế độ', 'cheDo'],
    adAccountId: ['Tài khoản quảng cáo', 'chu'],
    'policy.dailyBudgetCap': ['Trần ngân sách/ngày cho TẤT CẢ quảng cáo Pilot', 'dong'],
    'policy.automation.boostNewPosts': ['Tự lập quảng cáo cho bài mới', 'bat'],
    'policy.automation.scaleWinners': ['Tăng ngân sách quảng cáo tốt', 'bat'],
    'policy.automation.resumeRestocked': ['Chạy lại quảng cáo đã dừng khi có hàng lại', 'bat'],
    'policy.automation.pauseOutOfStock': ['Tạm dừng khi hết hàng / đổi giá', 'bat'],
    'policy.automation.pauseLosers': ['Tạm dừng khi chi không ra khách', 'bat'],
    'policy.budgetPerAd': ['Ngân sách mỗi quảng cáo mới (/ngày)', 'dong'],
    'policy.maxBudgetPerAd': ['Trần một quảng cáo (/ngày)', 'dong'],
    'policy.maxActiveAds': ['Quảng cáo chạy cùng lúc', 'so'],
    'policy.days': ['Số ngày chạy mỗi quảng cáo', 'so'],
    'policy.stopLossVnd': ['Mức dừng: chi mà chưa có khách hỏi', 'dong'],
    'policy.maxCostPerResult': ['Chi phí tối đa mỗi khách hỏi', 'dong'],
    'policy.minMarginPct': ['Máy tự đẩy khi lãi gộp từ', 'phanTram'],
    'policy.minStock': ['Chỉ quảng cáo hàng tồn từ', 'so'],
    'policy.postMaxAgeDays': ['Bài đăng trong (ngày)', 'so'],
    'policy.maxActionsPerDay': ['Thao tác quảng cáo mỗi ngày', 'so'],
    'policy.ageMin': ['Tuổi từ', 'so'],
    'policy.ageMax': ['Tuổi đến', 'so'],
    ...LICH,
}
