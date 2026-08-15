/**
 * Kiểm CÂU CHỈ ĐƯỜNG trong các cỗ máy soát — npx tsx scripts/check-chi-duong.ts
 *
 * Cảnh báo phát hiện đúng bệnh rồi bảo "Mở X để sửa" — mà menu không có mục nào
 * tên X. Người dùng đi tìm mỏi mắt rồi bỏ, và cảnh báo thành vô ích.
 *
 * NGÀY 14–15/08/2026 DÍNH NĂM LẦN, toàn những nhãn nghe rất hợp lý:
 *   "Thuế → Thanh tra thuế"      → thật ra là "Sẵn Sàng Thanh Tra"
 *   "Hoá Đơn VAT"                → thật ra là "Hóa Đơn VAT" (khác dấu)
 *   "trang Lịch thuế"            → không tồn tại
 *   "nhập Sổ Doanh Thu"          → thật ra là "S2b - Doanh Thu"
 *   "Mở Cài đặt → KiotViet"      → nằm ở trang quản trị /admin, không có trong menu
 *
 * ĐÃ THỬ VÀ BỎ một bản quét rộng (mọi cụm `Mở X` / `→ X` đối chiếu nhãn menu):
 * 19 báo động giả trên 19 — tiếng Việt trong câu văn không phân biệt được với
 * nhãn menu bằng heuristic. Bản này hẹp hơn hẳn và đo được 0/12 báo động giả:
 * chỉ soi ĐƯỜNG DẪN hai cấp `Nhóm → Mục` trong CHUỖI (bỏ chú thích), đối chiếu
 * một danh sách duyệt tay.
 *
 * ⚠ THÊM ĐƯỜNG MỚI VÀO `DUOC_DUYET` THÌ PHẢI MỞ MENU THẬT KIỂM TRƯỚC:
 *   open-retail/src/app/(dashboard)/layout.tsx
 * Chép đúng nhãn (kể cả dấu), và kiểm luôn cờ `companyOnly` / `hkdOnly` —
 * chỉ hộ kinh doanh sang một trang companyOnly là họ không mở được.
 */

import * as fs from 'fs'
import * as path from 'path'

/** Đường dẫn menu đã đối chiếu tay với layout.tsx, kèm ai mở được. */
const DUOC_DUYET: Array<{ duong: string; ai: string }> = [
    { duong: 'Kế Toán → Đối Chiếu Sổ Sách', ai: 'mọi loại hình' },
    { duong: 'Thuế → Báo Cáo Thuế', ai: 'CHỈ doanh nghiệp (companyOnly)' },
    { duong: 'Thuế → S2b - Doanh Thu', ai: 'CHỈ hộ kinh doanh (hkdOnly)' },
]

/* Tên nhóm menu cấp 1. Dò `Nhóm → ` sau khi đã gỡ hết đường đã duyệt ra —
 * nếu còn sót nghĩa là có một đường chưa ai kiểm. */
const NHOM = /(Thuế|Kế Toán|Cài đặt|Nhập Hàng|Kho|Báo Cáo|Bán Hàng|Hàng Hoá|Khách Hàng) → /

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

/** Bỏ chú thích: chúng CỐ Ý trích lại nhãn sai để giải thích lỗi cũ. */
function laChuThich(dong: string): boolean {
    const t = dong.trim()
    return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')
}

function quet(thuMuc: string) {
    const daDuyet: string[] = []
    const la: string[] = []
    for (const f of fs.readdirSync(thuMuc)) {
        if (!f.endsWith('.ts')) continue
        const noi = fs.readFileSync(path.join(thuMuc, f), 'utf8')
        noi.split('\n').forEach((dong, i) => {
            if (laChuThich(dong) || !dong.includes('→')) return
            let con = dong
            for (const d of DUOC_DUYET) {
                while (con.includes(d.duong)) { con = con.replace(d.duong, '‹ok›'); daDuyet.push(d.duong) }
            }
            const m = NHOM.exec(con)
            if (m) la.push(`${f}:${i + 1}  ${m[0]}…`)
        })
    }
    return { daDuyet, la }
}

function main() {
    console.log('\n▶ Câu chỉ đường trong src/lib\n')
    const { daDuyet, la } = quet('src/lib')

    ok('mọi đường dẫn menu đều nằm trong danh sách đã kiểm tay',
        la.length === 0, la)
    ok('có thật sự tìm thấy đường dẫn để kiểm (bộ dò còn sống)',
        daDuyet.length > 0, daDuyet.length)

    // Chiều ngược: bộ dò phải BẮT được một đường bịa
    const gia = 'canLam: "Mở Thuế → Lịch Thuế Tổng Hợp để xử lý"'
    let con = gia
    for (const d of DUOC_DUYET) con = con.split(d.duong).join('‹ok›')
    ok('bắt được đường dẫn không có trong danh sách', NHOM.test(con), gia)

    // Và KHÔNG bắt nhầm khi đường hợp lệ có thêm cấp con
    const that = 'canLam: "mở Thuế → Báo Cáo Thuế → tab Lịch Hạn Nộp rồi đánh dấu"'
    let con2 = that
    for (const d of DUOC_DUYET) con2 = con2.split(d.duong).join('‹ok›')
    ok('không bắt nhầm đường hợp lệ có cấp con', !NHOM.test(con2), that)

    console.log('\n  Đường đã duyệt (đối chiếu tay với layout.tsx):')
    for (const d of DUOC_DUYET) console.log(`    ${d.duong}  —  ${d.ai}`)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
