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

/**
 * "04-08-2026 16:00:02" | "04/08/2026" — MB dùng dd-mm-yyyy.
 * Giờ trong thư là GIỜ VIỆT NAM (+07). Dựng bằng `new Date(y, m, d, h…)` là lấy
 * múi giờ MÁY CHỦ — Cloud Run chạy UTC nên mọi giao dịch sẽ lệch 7 tiếng, đối
 * soát với sao kê lệch ngày. Ép +07 tường minh.
 */
function parseVnDate(raw: string): Date | null {
    const m = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(raw))
    if (!m) return null
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = m
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 7, Number(mi), Number(se)))
    return isNaN(dt.getTime()) ? null : dt
}

/**
 * Giải mã thực thể HTML. THƯ THẬT CỦA MB mã hoá TOÀN BỘ tiếng Việt thành thực
 * thể số: "S&#7889; tham chi&#7871;u" = "Số tham chiếu". Không giải mã thì mọi
 * nhãn tiếng Việt đều không khớp — đó là lý do 75/75 thư bị loại (đo 05/08).
 */
export function decodeEntities(s: string): string {
    return String(s)
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
}

/** MỌI nhãn của bảng giao dịch — dùng để cắt chuỗi thành cặp nhãn→giá trị. */
const MB_LABELS = [
    'Ngày, giờ giao dịch', 'Loại giao dịch', 'Số tham chiếu',
    'Tài khoản trích nợ', 'Tài khoản ghi có', 'Tài khoản thụ hưởng',
    'Người thụ hưởng', 'Người chuyển', 'Số tiền giao dịch', 'Số tiền',
    'Phí giao dịch', 'Nội dung chuyển tiền', 'Nội dung', 'Cách thức lệnh',
    'Ngày nhập lệnh', 'Thời gian', 'Tình trạng', 'Ngân hàng thụ hưởng',
]

/**
 * Cắt văn bản thành map nhãn→giá trị.
 * Bảng HTML thật xuống dòng LOẠN XẠ ngay giữa nhãn ("Ngày,\n giờ giao dịch")
 * và giá trị nằm cách nhãn nhiều dòng trắng — nên cách cũ (đòi nhãn và giá trị
 * cùng một dòng) không bao giờ khớp. Nay gom hết về một dòng rồi cắt theo vị
 * trí các nhãn: giá trị = phần nằm giữa nhãn này và nhãn kế tiếp.
 */
export function toFieldMap(text: string): Record<string, string> {
    const flat = decodeEntities(text).replace(/\s+/g, ' ').trim()
    const alts = MB_LABELS
        .map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'))
        .join('|')
    const re = new RegExp(`(${alts})\\s*[:：]?\\s*`, 'gi')
    const hits: { label: string; start: number; end: number }[] = []
    for (const m of flat.matchAll(re)) {
        hits.push({
            label: m[1].replace(/\s+/g, ' ').toLowerCase(),
            start: m.index!,
            end: m.index! + m[0].length,
        })
    }
    const out: Record<string, string> = {}
    for (let i = 0; i < hits.length; i++) {
        const stop = i + 1 < hits.length ? hits[i + 1].start : flat.length
        const val = flat.slice(hits[i].end, Math.max(hits[i].end, stop)).trim()
        // Nhãn lặp lại (bảng có dòng tóm tắt) → giữ lần đầu có giá trị
        if (val && !out[hits[i].label]) out[hits[i].label] = val
    }
    return out
}

function pick(fields: Record<string, string>, labels: string[]): string {
    for (const l of labels) {
        const v = fields[l.toLowerCase()]
        if (v) return v
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
        // Giải mã SAU khi bỏ thẻ, để &lt;div&gt; không biến thành thẻ thật
        .replace(/&#x[0-9a-f]+;|&#\d+;|&\w+;/gi, m => decodeEntities(m))
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

    const blob = decodeEntities(subject + '\n' + body).replace(/\s+/g, ' ')
    const fields = toFieldMap(subject + '\n' + body)

    // CHỈ nhận giao dịch đã thành công. Trạng thái đọc từ Ô "Tình trạng" chứ
    // không dò cả thư — thư chờ duyệt cũng chứa chữ "giao dịch thành công" ở
    // câu chào, dò cả thư là nhận nhầm.
    const statusCell = pick(fields, ['Tình trạng'])
    const okStatus = /Giao dịch thành công|Giao dich thanh cong|Thành công/i.test(statusCell)
    const loginNotice = /đăng nhập|dang nhap/i.test(subject)
    const pendingApproval = /chờ phê duyệt|cho phe duyet|chờ duyệt|cho duyet|pending approval/i.test(subject + ' ' + statusCell)
    if (!okStatus || loginNotice || pendingApproval) return null

    const referenceNo = pick(fields, ['Số tham chiếu', 'Reference']).replace(/[^\w-]/g, '')
    const amount = parseVndAmount(pick(fields, ['Số tiền giao dịch', 'Số tiền']))
    if (!referenceNo || !amount) return null

    const debitAcc = pick(fields, ['Tài khoản trích nợ'])
    const creditAcc = pick(fields, ['Tài khoản ghi có', 'Tài khoản thụ hưởng'])
    const beneficiary = pick(fields, ['Người thụ hưởng'])
    const content = pick(fields, ['Nội dung chuyển tiền', 'Nội dung'])
    const kind = pick(fields, ['Loại giao dịch'])

    // CHIỀU TIỀN: có "tài khoản trích nợ" = tiền RA (debit). Có "ghi có" mà
    // không có trích nợ = tiền VÀO. Không suy được thì BỎ QUA (xem đầu file).
    let type: 'credit' | 'debit' | null = null
    if (debitAcc) type = 'debit'
    else if (creditAcc) type = 'credit'
    else if (/ghi có|ghi co|nhận tiền|nhan tien|\+\s*[\d,.]+/i.test(blob)) type = 'credit'
    else if (/chuyển tiền|chuyen tien|thanh toán|thanh toan|trích nợ|trich no/i.test(blob)) type = 'debit'
    if (!type) return null

    const transactionDate =
        parseVnDate(pick(fields, ['Ngày, giờ giao dịch', 'Thời gian', 'Ngày nhập lệnh']))
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
