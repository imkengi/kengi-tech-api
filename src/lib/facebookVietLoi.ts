/* ═══════════════════════════════════════════════════════════════════════════════
 *  FACEBOOK PILOT — AI VIẾT LỜI BÀI, CÓ RÀO SỰ THẬT (10/11/2026, FB-14)
 *
 *  Trước: bài sản phẩm chỉ có MỘT khuôn (tên · giá · 400 ký tự đầu của mô tả · câu kêu gọi · hashtag) — fanpage đăng chục
 *  bài đọc như một bài. Ở đây AI viết lại ĐOẠN GIỚI THIỆU (2–4 câu) từ tên + mô tả trong kho. Chỉ đoạn đó: dòng tên, dòng
 *  giá, câu kêu gọi và hashtag vẫn do lib/facebookPilot.soanBai đặt từ dữ liệu kho + hồ sơ thương hiệu — AI không được
 *  chạm vào giá.
 *
 *  KHÔNG TIN MÙ AI (cùng lối lib/aiSoatNoiDung): lời AI phải qua `locLoiAi` —
 *    · MỌI con số phải có trong tên / mô tả (số không nguồn = số bịa);
 *    · lời hứa bán hàng (chính hãng, bảo hành, miễn phí, giảm giá, giao toàn quốc, còn hàng…) chỉ được có khi mô tả CÓ;
 *    · không đường dẫn, số điện thoại, Zalo (câu kêu gọi là của khuôn); không từ CẤM của thương hiệu;
 *    · mô tả quá ngắn ⇒ KHÔNG gọi AI (không có gì để viết ngoài bịa).
 *  Không qua rào ⇒ TỪ CHỐI kèm lý do, bài giữ khuôn cũ — không "sửa hộ" lời AI, không lặng lẽ dùng tạm.
 *
 *  CHỈ SOẠN NHÁP: không đường nào ở đây ghi lên Facebook. Người bấm «AI viết lời» ở form lên bài, đọc, sửa, rồi mới lập kế
 *  hoạch như mọi bài khác; chu kỳ tự động KHÔNG dùng AI.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { soTrong, docJsonAi } from './aiSoatNoiDung'

/** Mô tả (đã bỏ HTML) ngắn hơn bấy nhiêu ký tự ⇒ không gọi AI */
export const MO_TA_TOI_THIEU = 80
export const THAN_TOI_THIEU = 60
export const THAN_TOI_DA = 600
/** Số lần gọi AI tối đa cho một lần bấm (lần hai kèm lý do lần một bị loại) */
export const SO_LAN_VIET = 2

/** Lời hứa bán hàng — AI hay tự thêm cho "kêu". Chỉ được có trong lời khi tên / mô tả gốc CÓ đúng cụm đó. */
export const LOI_HUA = [
    'chính hãng', 'bảo hành', 'freeship', 'free ship', 'miễn phí', 'giảm giá', 'khuyến mãi', 'khuyến mại', 'ưu đãi', 'quà tặng', 'tặng kèm',
    'cam kết', 'số 1', 'tốt nhất', 'rẻ nhất', 'giá rẻ', 'giá tốt', 'giao hàng', 'toàn quốc', 'đổi trả', 'hoàn tiền', 'còn hàng', 'sẵn hàng', 'có sẵn',
    'số lượng có hạn', 'duy nhất', 'chứng nhận', 'kiểm định', 'tuyệt đối', 'chữa khỏi', 'điều trị', 'trọn đời', 'vĩnh viễn', 'bán chạy', 'hot nhất',
]

/** Đường dẫn / số điện thoại / kênh liên lạc — câu kêu gọi do khuôn bài đặt, AI không tự mời. */
export const DAN_RA_NGOAI = /https?:\/\/|www\.|\.(?:com|vn|net)\b|zalo|hotline|messenger|\binbox\b|(?:^|\D)(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/i

export const HUONG_DAN_VIET_LOI = `Bạn viết ĐOẠN GIỚI THIỆU cho một bài đăng sản phẩm trên fanpage Facebook của một cửa hàng ở Việt Nam.
Bạn nhận TÊN và MÔ TẢ GỐC do cửa hàng viết. Viết 2–4 câu (tổng 150–450 ký tự), tự nhiên, dễ đọc, nêu sản phẩm dùng để làm gì và điểm đáng chú ý nhất.

LUẬT BẮT BUỘC:
1. CHỈ dùng thông tin CÓ TRONG tên + mô tả. KHÔNG bịa công dụng, số liệu, chất liệu, chứng nhận. Mọi con số giữ y nguyên như mô tả.
2. KHÔNG nhắc giá, khuyến mãi, quà tặng, bảo hành, chính hãng, giao hàng, đổi trả, còn hàng — trừ khi mô tả ghi rõ đúng điều đó.
3. KHÔNG số điện thoại, Zalo, đường dẫn, "inbox", lời kêu gọi mua (bài đã có sẵn câu kêu gọi), KHÔNG hashtag, KHÔNG nhắc lại nguyên tên sản phẩm ở đầu.
4. KHÔNG so sánh nhất ("tốt nhất", "số 1"), không cam kết hiệu quả.
5. Tiếng Việt có dấu, đúng chính tả. Không markdown, không gạch đầu dòng.
Chỉ trả về MỘT đối tượng JSON, không giải thích: {"than":"..."}`

export interface KetQuaLoc { ok: boolean; than: string; lyDo: string }

const thap = (s: string) => String(s || '').toLowerCase().normalize('NFC')

/** Rào sự thật cho đoạn AI viết. `nguon` = tên + mô tả (đã bỏ HTML). Hàm THUẦN. */
export function locLoiAi(raw: unknown, ten: string, moTa: string, tuCam: string[] = []): KetQuaLoc {
    const than = String(raw ?? '').normalize('NFC').replace(/[*_`]+/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n+ */g, '\n').trim()
    const tu = (lyDo: string): KetQuaLoc => ({ ok: false, than, lyDo })
    if (!than) return tu('AI trả lời rỗng')
    if (than.length < THAN_TOI_THIEU) return tu(`lời quá ngắn (${than.length} ký tự, cần ≥ ${THAN_TOI_THIEU})`)
    if (than.length > THAN_TOI_DA) return tu(`lời quá dài (${than.length} ký tự, tối đa ${THAN_TOI_DA})`)
    if (/#[\p{L}\d_]/u.test(than)) return tu('có hashtag (hashtag do khuôn bài đặt)')
    if (DAN_RA_NGOAI.test(than)) return tu('có đường dẫn / số điện thoại / lời mời liên hệ (câu kêu gọi do khuôn bài đặt)')
    const nguon = `${ten}\n${moTa}`
    const soNguon = new Set(soTrong(nguon))
    const soLa = [...new Set(soTrong(than).filter(n => !soNguon.has(n)))]
    if (soLa.length) return tu(`có con số không có trong tên / mô tả: ${soLa.join(', ')}`)
    const nguonThap = thap(nguon), thanThap = thap(than)
    const hua = LOI_HUA.filter(w => thanThap.includes(w) && !nguonThap.includes(w))
    if (hua.length) return tu(`có lời hứa mô tả không ghi: ${hua.join(', ')}`)
    const cam = [...new Set(tuCam.map(w => thap(w).trim()).filter(Boolean))].filter(w => thanThap.includes(w))
    if (cam.length) return tu(`có từ CẤM của thương hiệu: ${cam.join(', ')}`)
    return { ok: true, than, lyDo: '' }
}

export function deBaiVietLoi(ten: string, moTa: string, lyDoLanTruoc?: string): string {
    return `TÊN: ${ten}\n\nMÔ TẢ GỐC:\n${moTa.slice(0, 4000)}`
        + (lyDoLanTruoc ? `\n\nLần viết trước bị loại vì: ${lyDoLanTruoc}. Viết lại, tuân thủ đúng luật.` : '')
}

export type GoiAi = (deBai: string, huongDan: string) => Promise<string>

/**
 * Gọi AI tối đa SO_LAN_VIET lần tới khi lời qua rào. Trả { ok:false, lyDo } khi không lần nào qua — KHÔNG ném cho lỗi của rào;
 * lỗi gọi AI (không có key, hết hạn mức…) thì ném nguyên để nơi gọi báo đúng việc.
 */
export async function vietLoiCoRao(goiAi: GoiAi, ten: string, moTa: string, tuCam: string[] = []): Promise<KetQuaLoc & { soLan: number }> {
    let cuoi: KetQuaLoc = { ok: false, than: '', lyDo: 'chưa gọi AI' }
    for (let i = 1; i <= SO_LAN_VIET; i++) {
        const text = await goiAi(deBaiVietLoi(ten, moTa, i > 1 ? cuoi.lyDo : undefined), HUONG_DAN_VIET_LOI)
        let than: unknown
        try { than = docJsonAi(text)?.than } catch { than = '' ; cuoi = { ok: false, than: '', lyDo: 'AI không trả đúng khuôn JSON' }; continue }
        cuoi = locLoiAi(than, ten, moTa, tuCam)
        if (cuoi.ok) return { ...cuoi, soLan: i }
    }
    return { ...cuoi, soLan: SO_LAN_VIET }
}
