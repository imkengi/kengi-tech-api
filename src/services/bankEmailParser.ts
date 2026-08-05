/**
 * BÓC GIAO DỊCH NGÂN HÀNG TỪ EMAIL (2026-08-05)
 *
 * Thư báo biến động số dư của MB Bank là bảng nhãn–giá trị cố định. Bóc ra
 * BankTransaction để chảy vào đúng đường ống E-Banking đã có (đối soát, gắn
 * phiếu thu/chi) — KHÔNG dựng hệ song song.
 *
 * NGUYÊN TẮC ĐỘ CHÍNH XÁC (đây là tiền, không được đoán):
 *  - Thiếu SỐ TIỀN hoặc SỐ THAM CHIẾU → bỏ qua, không tạo bản ghi nửa vời.
 *    Số tham chiếu là khoá chống trùng; không có nó thì quét lại sẽ nhân đôi.
 *  - Không suy được THU hay CHI thì bỏ qua — ghi nhầm chiều tiền còn tệ hơn
 *    không ghi, vì nó lặng lẽ làm sai sổ quỹ.
 *  - Chỉ nhận thư có "Tình trạng: Giao dịch thành công"; thư báo đăng nhập,
 *    OTP, giao dịch chờ duyệt đều không phải biến động tiền.
 */

export interface ParsedBankTx {
    referenceNo: string
    amount: number
    type: 'credit' | 'debit'
    transactionDate: Date
    description: string
    counterpartyName?: string
    counterpartyAccount?: string
    bankHint: string
}

/** Số tiền VN: "5,994,000.00" | "5.994.000" | "(VND) 5,994,000.00" */
function parseVndAmount(raw: string): number {
    let s = String(raw).replace(/\(?VND\)?/gi, '').replace(/\s/g, '').trim()
    if (!s) return 0
    // Có cả '.' lẫn ',' → dấu xuất hiện SAU CÙNG là dấu thập phân
    if (s.includes('.') && s.includes(',')) {
        s = s.lastIndexOf('.') > s.lastIndexOf(',')
            ? s.replace(/,/g, '')
            : s.replace(/\./g, '').replace(',', '.')
    } else if (s.includes(',')) {
        // ",00" cuối = thập phân; còn lại là ngăn nghìn
        s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
    } else if (s.includes('.')) {
        // "5.994.000" (ngăn nghìn) vs "5994000.00" (thập phân)
        if (!/\.\d{1,2}$/.test(s) || (s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '')
    }
    const n = Number(s)
    return isFinite(n) ? Math.abs(n) : 0
}

/** "04-08-2026 16:00:02" | "04/08/2026" — MB dùng dd-mm-yyyy */
function parseVnDate(raw: string): Date | null {
    const m = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(raw))
    if (!m) return null
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = m
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se))
    return isNaN(dt.getTime()) ? null : dt
}

/** Lấy giá trị theo nhãn trong bảng thư (HTML đã rút thẻ hoặc text thuần). */
function pick(text: string, labels: string[]): string {
    for (const label of labels) {
        const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]?\\s*([^\\n\\r]{1,160})', 'i')
        const m = re.exec(text)
        if (m?.[1]) {
            const v = m[1].trim().replace(/\s{2,}/g, ' ')
            if (v) return v
        }
    }
    return ''
}

/** HTML → text giữ ngắt dòng để cặp nhãn–giá trị không dính vào nhau. */
export function htmlToText(html: string): string {
    return String(html)
        .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, ' ')
        // CHỈ xuống dòng ở ranh giới HÀNG/khối. `</td>` mà xuống dòng là tách
        // nhãn khỏi giá trị (nhãn ở ô này, giá trị ở ô kế) → không cặp nào khớp,
        // parser trả null sạch. Ô trong cùng hàng ngăn bằng TAB.
        .replace(/<\s*(br|\/tr|\/p|\/div|\/h\d)\s*\/?>/gi, '\n')
        .replace(/<\/?t[dh][^>]*>/gi, '\t')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim()
}

/**
 * Trả về null khi thư KHÔNG phải báo giao dịch thành công, hoặc thiếu dữ liệu
 * bắt buộc. Người gọi chỉ việc bỏ qua null.
 */
export function parseBankEmail(input: {
    subject?: string
    from?: string
    text?: string
    html?: string | null
    receivedAt?: Date
}): ParsedBankTx | null {
    const from = String(input.from || '').toLowerCase()
    const subject = String(input.subject || '')
    const body = input.text && input.text.trim().length > 40
        ? input.text
        : htmlToText(input.html || '')
    if (!body) return null

    // Nhận diện ngân hàng — mở rộng thêm ngân hàng khác ở đây khi có mẫu thư thật
    const isMB = /mbbank\.com\.vn|\bMB eBanking\b|mbebanking/i.test(from + ' ' + body)
    if (!isMB) return null

    const blob = subject + '\n' + body

    // CHỈ nhận giao dịch đã thành công. "Giao dich cho phe duyet" (chờ duyệt),
    // "Thong bao dang nhap" (đăng nhập) không phải biến động tiền.
    const okStatus = /Tình trạng[^\n]*Giao dịch thành công|Tinh trang[^\n]*Giao dich thanh cong/i.test(blob)
    const loginNotice = /đăng nhập|dang nhap/i.test(subject)
    const pendingApproval = /chờ phê duyệt|cho phe duyet|pending approval/i.test(blob)
    if (!okStatus || loginNotice || pendingApproval) return null

    const referenceNo = pick(blob, ['Số tham chiếu', 'So tham chieu', 'Reference'])
        .replace(/[^\w-]/g, '')
    const amountRaw = pick(blob, ['Số tiền giao dịch', 'So tien giao dich', 'Số tiền', 'So tien'])
    const amount = parseVndAmount(amountRaw)
    if (!referenceNo || !amount) return null

    const debitAcc = pick(blob, ['Tài khoản trích nợ', 'Tai khoan trich no'])
    const creditAcc = pick(blob, ['Tài khoản ghi có', 'Tai khoan ghi co', 'Tài khoản thụ hưởng'])
    const beneficiary = pick(blob, ['Người thụ hưởng', 'Nguoi thu huong'])
    const content = pick(blob, ['Nội dung chuyển tiền', 'Noi dung chuyen tien', 'Nội dung', 'Noi dung'])
    const kind = pick(blob, ['Loại giao dịch', 'Loai giao dich'])

    // CHIỀU TIỀN: có "tài khoản trích nợ" = tiền RA (debit). Có "ghi có" mà
    // không có trích nợ = tiền VÀO. Không suy được thì BỎ QUA (xem đầu file).
    let type: 'credit' | 'debit' | null = null
    if (debitAcc) type = 'debit'
    else if (creditAcc) type = 'credit'
    else if (/ghi có|ghi co|nhận tiền|nhan tien|\+\s*[\d,.]+/i.test(blob)) type = 'credit'
    else if (/chuyển tiền|chuyen tien|thanh toán|thanh toan|trích nợ|trich no/i.test(blob)) type = 'debit'
    if (!type) return null

    const transactionDate =
        parseVnDate(pick(blob, ['Ngày, giờ giao dịch', 'Ngay, gio giao dich', 'Thời gian', 'Thoi gian', 'Ngày nhập lệnh']))
        || input.receivedAt || new Date()

    const description = [kind || 'Giao dịch ngân hàng', content].filter(Boolean).join(' — ').slice(0, 300)

    return {
        referenceNo,
        amount,
        type,
        transactionDate,
        description,
        counterpartyName: (beneficiary || '').slice(0, 200) || undefined,
        counterpartyAccount: (type === 'debit' ? creditAcc : debitAcc)?.slice(0, 100) || undefined,
        bankHint: 'MB',
    }
}
