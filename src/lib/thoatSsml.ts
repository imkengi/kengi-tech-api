/**
 * Chữ gửi Edge TTS (msedge-tts) phải THOÁT ký tự XML.
 *
 * msedge-tts 2.1.0 (`_SSMLTemplate`) nhét chữ THẲNG vào SSML, không thoát ⇒ một dấu "&" thô trong tên hàng
 * ("Đầu Tròn & Uốn Cong", "215mm & 280mm") làm Edge đóng luồng sau ~0,7 s không trả âm thanh ("Stream closed
 * before the synthesis completed (no turn.end received)", đo 21/11/2026) ⇒ /livestream/tts thử 3 lần rồi rơi về
 * giọng Google — giữa buổi live đổi giọng. Đã thoát thì Edge đọc bình thường (đo cùng ngày: 2,81 s, ngang câu "và").
 *
 * Chỉ thoát lúc GỬI Edge; chữ trong yêu cầu (khoá đệm phía studio/máy phát/điện thoại) giữ nguyên.
 * Máy phát (ai-livestream-studio/engine/tts.mjs `xmlSsml`) thoát y hệt.
 */
export function thoatSsml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
