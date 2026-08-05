import { htmlToText } from './bankEmailParser'

/**
 * BÓC HOÁ ĐƠN ĐẦU VÀO TỪ EMAIL THÔNG BÁO (2026-08-05)
 *
 * Nhà cung cấp phát hành HĐĐT thì phần mềm của họ (EasyInvoice/Softdreams,
 * VNPT, Viettel, MISA…) gửi mail thông báo — dữ liệu nằm NGAY TRONG THÂN THƯ,
 * thường KHÔNG có tệp đính kèm. Bóc ra để lên phiếu chi + giữ thông tin khấu
 * trừ VAT (mất số hoá đơn/MST người bán là mất quyền khấu trừ).
 *
 * NGUYÊN TẮC (tiền + thuế, không đoán):
 *  - Thiếu SỐ HOÁ ĐƠN hoặc TỔNG TIỀN → bỏ qua. Số hoá đơn + MST người bán là
 *    khoá chống trùng; thiếu thì quét lại sẽ nhân đôi chi phí.
 *  - MST NGƯỜI BÁN phải khác MST người mua. Thư thông báo chứa CẢ HAI mã số
 *    thuế; lấy nhầm mã của chính mình là ghi nhà cung cấp = chính cửa hàng.
 *  - Tiền thuế thiếu thì để 0, KHÔNG tự suy từ tổng tiền — thuế suất 0%/5%/8%/
 *    10% và hàng không chịu thuế đều tồn tại, suy bừa là khai sai.
 */

export interface ParsedEInvoice {
    invoiceNo: string
    invoiceSymbol?: string
    invoiceDate?: Date
    sellerName: string
    sellerTaxCode: string
    buyerTaxCode?: string
    totalAmount: number
    vatAmount: number
    lookupCode?: string
    taxAuthorityCode?: string
    /** Khoá chống trùng: MST bán + ký hiệu + số hoá đơn */
    dedupKey: string
}

function parseMoney(raw: string): number {
    let s = String(raw).replace(/[^\d.,-]/g, '').trim()
    if (!s) return 0
    if (s.includes('.') && s.includes(',')) {
        s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
    } else if (s.includes(',')) {
        s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
    } else if (s.includes('.')) {
        if (!/\.\d{1,2}$/.test(s) || (s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '')
    }
    const n = Number(s)
    return isFinite(n) ? Math.abs(n) : 0
}

function parseDmy(raw: string): Date | null {
    const m = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(String(raw))
    if (!m) return null
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
    return isNaN(d.getTime()) ? null : d
}

/**
 * Lấy giá trị theo nhãn. ƯU TIÊN nhãn đứng ĐẦU DÒNG.
 * Bẫy đã trả giá: "Số hóa đơn" là chuỗi con của "Ký hiệu mẫu số hóa đơn" nằm
 * NGAY TRÊN nó, nên tìm tự do sẽ vớ phải ký hiệu (1C26MVB) thay vì số (21100).
 * Quét vòng 1 có neo đầu dòng/ô; không thấy mới nới ra vòng 2.
 */
function pick(text: string, labels: string[]): string {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const anchored of [true, false]) {
        for (const label of labels) {
            const prefix = anchored ? '(?:^|[\\n\\r\\t])[\\s]*' : ''
            const re = new RegExp(prefix + esc(label) + '\\s*[:：]?\\s*([^\\n\\r\\t]{1,200})', 'im')
            const m = re.exec(text)
            if (m?.[1]) {
                const v = m[1].trim().replace(/\s{2,}/g, ' ')
                if (v) return v
            }
        }
    }
    return ''
}

export function parseEInvoiceEmail(input: {
    subject?: string
    from?: string
    text?: string
    html?: string | null
    /** MST của chính cửa hàng — để loại trừ, không nhận nhầm làm người bán */
    ownTaxCode?: string
}): ParsedEInvoice | null {
    const subject = String(input.subject || '')
    const body = input.text && input.text.trim().length > 60 ? input.text : htmlToText(input.html || '')
    if (!body) return null
    const blob = subject + '\n' + body

    // Phải là THÔNG BÁO PHÁT HÀNH hoá đơn, không phải quảng cáo/nhắc hạn
    const looksLikeInvoice = /hóa đơn điện tử|hoá đơn điện tử|số hóa đơn|số hoá đơn/i.test(blob)
        && /(vừa phát hành|đã phát hành|kính gửi|thông báo)/i.test(blob)
    if (!looksLikeInvoice) return null

    const invoiceNo = pick(blob, ['Số hóa đơn', 'Số hoá đơn', 'So hoa don']).replace(/[^\w]/g, '')
    // Nhãn tiền: thử NHIỀU nhãn và bỏ qua nhãn vớ phải chuỗi không có số.
    // Bẫy Shopee: nhãn của họ là "Tổng tiền giá trị hóa đơn sau thuế" — nhãn
    // ngắn "Tổng tiền" khớp giữa cụm, vớ được "giá trị hóa đơn sau thuế:" (không
    // số) → tiền 0 → loại oan cả thư. Nhãn DÀI phải đứng trước, và giá trị
    // không ra số thì thử tiếp nhãn sau chứ không dừng.
    const moneyLabels = [
        'Tổng tiền giá trị hóa đơn sau thuế', 'Tổng tiền thanh toán',
        'Tổng cộng tiền thanh toán', 'Tong tien thanh toan', 'Tổng tiền',
    ]
    let totalAmount = 0
    for (const l of moneyLabels) {
        totalAmount = parseMoney(pick(blob, [l]))
        if (totalAmount) break
    }
    if (!invoiceNo || !totalAmount) return null

    // NGƯỜI BÁN vs NGƯỜI MUA: thư chứa CẢ HAI mã số thuế. Tín hiệu chắc nhất là
    // cặp "TÊN, Mã số thuế XXX" — lấy cặp ĐẦU TIÊN không phải MST của mình
    // (mẫu thư luôn giới thiệu bên phát hành trước, rồi mới tới "Quý khách").
    const own = String(input.ownTaxCode || '').replace(/[^\d-]/g, '')
    const pairs: { name: string; tax: string }[] = []
    // Nhánh DÀI đứng trước: MST cá nhân/hộ KD có 12 số, doanh nghiệp 10 số (có
    // thể kèm -XXX chi nhánh). Để \d{10} trước là cắt cụt 052200014638 thành
    // 0522000146 → so sánh với MST cửa hàng không khớp, lọc người mua hụt.
    // Nhận cả "MST" — tiêu đề Shopee viết "CÔNG TY TNHH SHOPEE - MST: 0106773786"
    const nameRe = /([A-ZÀ-Ỹ][^\n,]{5,120}?)\s*[-,]?\s*(?:Mã số thuế|MST)\s*:?\s*(\d{10}-\d{3}|\d{13}|\d{12}|\d{10})/gi
    for (const m of blob.matchAll(nameRe)) pairs.push({ name: m[1].trim(), tax: m[2] })

    // KHÔNG rơi về pairs[0] khi mọi cặp đều là MST của mình — thư Shopee chỉ có
    // cặp "Tên đơn vị, MST" của NGƯỜI MUA trong thân thư; rơi về pairs[0] là ghi
    // nhà cung cấp = chính cửa hàng. Không có cặp hợp lệ thì để fallback allTax lo.
    const sellerPair = pairs.find(p => !own || p.tax !== own) || (own ? undefined : pairs[0])
    let sellerTaxCode = sellerPair?.tax || ''
    let sellerName = sellerPair?.name || ''
    // Cặp bắt trong TIÊU ĐỀ hay dính cả cụm dẫn ("Hóa đơn điện tử số X được gửi
    // từ CÔNG TY…") — có chữ mở đầu pháp nhân thì cắt từ đó
    const legal = /((?:CÔNG TY|CTY|DOANH NGHIỆP|HỘ KINH DOANH|HKD|TỔNG CÔNG TY)[^\n]*)/i.exec(sellerName)
    if (legal) sellerName = legal[1].trim()
    const buyerTaxCode = (own && pairs.some(p => p.tax === own))
        ? own
        : pairs.find(p => p.tax !== sellerTaxCode)?.tax

    if (!sellerTaxCode) {
        // Không có cặp nào → lấy MST đầu tiên khác MST của mình
        const allTax = Array.from(blob.matchAll(/\b(\d{10}-\d{3}|\d{13}|\d{12}|\d{10})\b/g)).map(m => m[1])
        sellerTaxCode = allTax.find(t => !own || t !== own) || ''
    }
    if (!sellerName) {
        // Tiêu đề dạng "Hóa đơn điện tử số: 21100 - CÔNG TY ... kính gửi khách hàng X"
        const s = /-\s*(CÔNG TY[^\n]*?)\s+kính gửi/i.exec(subject)
            || /gửi từ\s+(CÔNG TY[^\n-]{3,120}?)\s*-/i.exec(subject)
            || /^\s*(CÔNG TY[^\n,]{5,120})/im.exec(body)
        sellerName = s?.[1]?.trim() || ''
    }
    if (!sellerTaxCode && !sellerName) return null

    const invoiceSymbol = pick(blob, ['Ký hiệu mẫu số hóa đơn', 'Ký hiệu mẫu số hoá đơn', 'Ký hiệu hóa đơn', 'Ký hiệu']).replace(/[^\w/]/g, '') || undefined
    const invoiceDate = parseDmy(pick(blob, ['Ngày hóa đơn', 'Ngày hoá đơn', 'Ngay hoa don'])) || undefined
    // Thiếu thì để 0 — xem ghi chú đầu file, KHÔNG suy từ tổng tiền
    const vatAmount = parseMoney(pick(blob, ['Tiền thuế', 'Tien thue', 'Thuế GTGT', 'Tiền thuế GTGT']))
    const lookupCode = pick(blob, ['Mã tra cứu', 'Mã nhận hóa đơn', 'Mã nhận hoá đơn', 'Ma tra cuu']).replace(/[^\w]/g, '') || undefined
    // Mã CQT phải là MỘT token mã (chữ+số). "mã của cơ quan thuế" còn xuất hiện
    // giữa câu giải thích Thông tư 78 ở chân thư Shopee — vớ câu đó là ra rác.
    const cqtTok = (pick(blob, ['Mã của cơ quan thuế', 'Ma cua co quan thue', 'Mã CQT']).split(/\s+/)[0] || '').replace(/[^\w-]/g, '')
    const taxAuthorityCode = /^[A-Za-z0-9-]{6,40}$/.test(cqtTok) ? cqtTok : undefined

    return {
        invoiceNo,
        invoiceSymbol,
        invoiceDate,
        sellerName: sellerName.slice(0, 200),
        sellerTaxCode,
        buyerTaxCode,
        totalAmount,
        vatAmount,
        lookupCode,
        taxAuthorityCode,
        dedupKey: `${sellerTaxCode || 'NA'}|${invoiceSymbol || ''}|${invoiceNo}`,
    }
}
