/**
 * MÃ HOÁ TOKEN NỀN TẢNG (AES-256-GCM) — Marketing Studio, 05/09/2026
 *
 * Vì sao cần: `FbPage.accessToken` đang lưu THÔ trong cơ sở dữ liệu. Ai đọc được
 * một bản sao lưu là đăng bài được lên trang khách hàng. `MktAccount.accessToken`
 * lưu bản mã hoá thay thế.
 *
 * ⛔ KHOÁ PHẢI TỪ BIẾN MÔI TRƯỜNG, TUYỆT ĐỐI KHÔNG SINH RA RỒI GHI XUỐNG ĐĨA.
 *
 * Bản độc lập (`scratch/fanpage-dashboard/marketing/config.js`) sinh khoá ngẫu
 * nhiên rồi ghi `vault.key` vào thư mục dữ liệu. Trên máy cá nhân thì đúng. Trên
 * Cloud Run thì đĩa là TẠM: container restart là mất khoá, và **toàn bộ token đã
 * mã hoá thành rác không tài nào giải được**. Đo 05/09/2026: container này sập vì
 * SIGSEGV 69 lần / 30 ngày — tức là mỗi ngày vài lần mất khoá.
 *
 * Nên ở đây: thiếu khoá thì NÉM LỖI, không im lặng sinh khoá mới. Một lỗi ồn ào
 * lúc khởi động rẻ hơn nhiều so với một kho token âm thầm hỏng.
 */
import crypto from 'crypto'

const DAI_KHOA_HEX = 64 // 32 byte = AES-256

/** Đọc khoá vault từ env. Ném lỗi nếu thiếu hoặc sai định dạng — CỐ Ý. */
export function layKhoaVault(): Buffer {
    const hex = String(process.env.MARKETING_VAULT_KEY || '').trim()
    if (!hex) {
        throw new Error(
            'Thiếu MARKETING_VAULT_KEY. Đặt một chuỗi 64 ký tự hex trong Secret Manager ' +
            'rồi khai vào cloudbuild.yaml. KHÔNG tự sinh khoá: đĩa Cloud Run là tạm, ' +
            'sinh khoá mới sau mỗi lần restart sẽ làm mọi token đã lưu không giải được nữa.'
        )
    }
    if (!new RegExp(`^[a-f0-9]{${DAI_KHOA_HEX}}$`, 'i').test(hex)) {
        throw new Error(`MARKETING_VAULT_KEY phải là ${DAI_KHOA_HEX} ký tự hex (32 byte).`)
    }
    return Buffer.from(hex, 'hex')
}

/** Có khoá hay không — dùng để bộ đo trả lời mà không cần ném lỗi. */
export function coKhoaVault(): boolean {
    try { layKhoaVault(); return true } catch { return false }
}

/**
 * Mã hoá thành chuỗi "iv.tag.body" (mỗi phần base64).
 * IV 12 byte ngẫu nhiên MỖI LẦN — dùng lại IV với cùng khoá là phá sạch GCM.
 */
export function maHoa(giaTri: string, khoa: Buffer = layKhoaVault()): string {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', khoa, iv)
    const than = Buffer.concat([cipher.update(giaTri, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), than].map(b => b.toString('base64')).join('.')
}

/**
 * Giải mã. Ném lỗi nếu chuỗi hỏng hoặc thẻ xác thực không khớp (token bị sửa,
 * hoặc khoá đã đổi). KHÔNG nuốt lỗi trả chuỗi rỗng: "giải không được" phải khác
 * hẳn "token rỗng", nếu không thì lỗi khoá sẽ hiện ra dưới dạng "chưa kết nối".
 */
export function giaiMa(chuoi: string, khoa: Buffer = layKhoaVault()): string {
    const phan = String(chuoi || '').split('.')
    if (phan.length !== 3) throw new Error('Chuỗi mã hoá sai định dạng (cần "iv.tag.body").')
    const [iv, tag, than] = phan.map(v => Buffer.from(v, 'base64'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', khoa, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(than), decipher.final()]).toString('utf8')
}

/**
 * Che token để ghi log / trả về màn hình. KHÔNG BAO GIỜ trả ký tự nào của token —
 * chỉ độ dài. Bốn ký tự cuối nghe có vẻ vô hại nhưng với token ngắn là đủ để dò.
 */
export function cheToken(token: string | null | undefined): string {
    const n = String(token || '').length
    return n ? `(đã ẩn, dài ${n})` : '(trống)'
}
