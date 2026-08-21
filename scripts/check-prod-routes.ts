/**
 * CANARY: route trọng yếu còn sống trên prod không? — npx tsx scripts/check-prod-routes.ts
 *
 * Vì sao có (sự cố 18→20/08/2026): mảng kế toán deploy xong, chạy đúng, rồi biến mất khỏi prod
 * vì nguồn deploy khác ghi đè (CI build HEAD / deploy lại image cũ). HAI NGÀY không ai biết;
 * bản vá "thiếu ≠ 0" mất theo ⇒ 24 khách bị xoá nợ (1.264.231.175đ).
 *
 * ⚠ BẪY CỦA CHÍNH BỘ NÀY (đo 20/08): nhiều mount gắn authMiddleware ở CẤP MOUNT, nên đường
 * KHÔNG TỒN TẠI cũng trả 401/403 — chỉ nhìn mã trạng thái là báo "có" một cách sai. Nên mỗi
 * route đi kèm một ĐƯỜNG GIẢ cùng mount để đối chứng:
 *
 *   giả 404, thật ≠ 404  → route CÓ
 *   thật 404             → route MẤT (báo động)
 *   giả == thật ∈ {401,403} → KHÔNG KIỂM ĐƯỢC nếu không có token (nói thẳng, không đoán)
 *
 * Có token thì đặt PROD_TOKEN=... để kiểm được cả những mount đó.
 */

const BASE = process.env.PROD_API || 'https://api.kengi.vn/api'
const TOKEN = process.env.PROD_TOKEN || ''
const ADMIN_KEY = process.env.PROD_ADMIN_KEY || ''   // nhóm /admin/* chặn bằng x-admin-key, không phải Bearer

/* ⚠ DANH SÁCH NÀY CHỈ DÀNH CHO ROUTE **GET**. Chỗ dò gọi `fetch(BASE + p, { headers })` —
 * không truyền `method` nên luôn là GET. Thêm một route **POST-only** vào đây thì GET sẽ trả 404
 * và bộ soát báo "MẤT" trong khi route vẫn sống — **báo động giả, đúng lúc đang cần tin nó nhất**.
 *
 * Và ĐỪNG "nâng cấp" thành dò theo method: dò POST nghĩa là **thật sự gọi** route đó.
 * `POST /admin/migrate` mà đem ra dò là **chạy migration thật** chỉ để xem route có tồn tại không.
 * Route POST thì cứ để nghiệp vụ tự báo (gọi xong đọc phản hồi), đừng dò trước.
 */
const ROUTES: Array<{ duong: string; gia: string; vi: string }> = [
    { duong: '/health', gia: '/duong-gia-xyz', vi: 'máy chủ sống' },
    { duong: '/import-receipts/payment-due', gia: '/import-receipts/duong-gia-xyz', vi: 'trang Hạn Thanh Toán NCC' },
    { duong: '/customers/financial-overview', gia: '/customers/duong-gia-xyz', vi: 'bảng tổng quan sức khoẻ tài chính' },
    { duong: '/customers/segments-live', gia: '/customers/duong-gia-xyz', vi: 'hạng/tuổi nợ sống (bảng KH, widget VIP)' },
    { duong: '/admin/kiotviet-no-khach', gia: '/admin/duong-gia-xyz', vi: 'ĐỐI CHIẾU NỢ KHÁCH ↔ KiotViet — công cụ cứu nợ bị xoá' },
    { duong: '/admin/kiotviet-no-ncc', gia: '/admin/duong-gia-xyz', vi: 'đối chiếu công nợ NCC ↔ KiotViet' },
    { duong: '/debts/summary', gia: '/debts/duong-gia-xyz', vi: 'trang Công Nợ' },
    { duong: '/tax/debt-aging', gia: '/tax/duong-gia-xyz', vi: 'tuổi nợ 131/331' },
    // Thêm 20/08 tối: những đường bị đụng trong đợt soát "đọc hỏng ≠ bằng 0"
    { duong: '/import-receipts/duplicates', gia: '/import-receipts/duong-gia-xyz', vi: 'dò phiếu nhập trùng số hoá đơn' },
    { duong: '/ebanking/overview', gia: '/ebanking/duong-gia-xyz', vi: 'tổng quan ngân hàng' },
    { duong: '/ebanking/dashboard', gia: '/ebanking/duong-gia-xyz', vi: 'thẻ tổng số dư ngân hàng (route tên /dashboard, KHÔNG phải /summary — bản đầu canary ghi sai và tự báo MẤT)' },
    { duong: '/tax/export/journal-book', gia: '/tax/duong-gia-xyz', vi: 'xuất sổ nhật ký chung' },
    { duong: '/tax/deadlines', gia: '/tax/duong-gia-xyz', vi: 'lịch nghĩa vụ thuế' },
    { duong: '/ccdc', gia: '/ccdc/duong-gia-xyz', vi: 'sổ CCDC (phân bổ theo kỳ)' },
    { duong: '/fixed-assets', gia: '/fixed-assets/duong-gia-xyz', vi: 'sổ tài sản (khấu hao theo kỳ)' },
    { duong: '/payroll/periods', gia: '/payroll/duong-gia-xyz', vi: 'kỳ lương' },
]

const headers: Record<string, string> = {
    ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
    ...(ADMIN_KEY ? { 'x-admin-key': ADMIN_KEY } : {}),
}
const ma = async (p: string): Promise<number> => {
    try { return (await fetch(BASE + p, { headers })).status } catch { return -1 }
}

/* So DẤU ẤN BẢN ĐANG CHẠY với cây mã ở máy — trả lời thẳng câu "prod có phải bản này không", thay
 * vì phải dò từng route xem cái nào 404 (cách duy nhất có được tối 20/08 vì chưa có dấu ấn). */
async function soDauAn() {
    let shaMay = ''
    try { shaMay = require('child_process').execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() } catch { }
    try {
        const r = await fetch(BASE + '/health')
        const b: any = await r.json()
        const bd = b?.build
        if (!bd || bd.sha === 'khong-ro') {
            console.log('  · dấu ấn: máy chủ CHƯA có (ảnh cũ hơn bản vá 20/08) — chưa so được, phải dò từng route')
        } else if (shaMay && bd.sha !== shaMay) {
            console.log(`  ✗ dấu ấn LỆCH: prod chạy ${bd.sha} (${bd.trangThai}), cây ở máy là ${shaMay}`)
        } else {
            console.log(`  ✓ dấu ấn khớp: ${bd.sha} (${bd.trangThai})`)
        }
        if (bd?.trangThai === 'ban') console.log('  ⚠ bản đang chạy được deploy từ cây CÓ SỬA CHƯA COMMIT')
    } catch { console.log('  · dấu ấn: không gọi được /health') }
}

async function main() {
    console.log(`\n▶ Canary route prod — ${BASE}${TOKEN ? ' (có token)' : ' (không token)'}\n`)
    await soDauAn()
    console.log('')
    let co = 0, mat = 0, khongBiet = 0
    const cacheGia = new Map<string, number>()
    for (const r of ROUTES) {
        const that = await ma(r.duong)
        if (!cacheGia.has(r.gia)) cacheGia.set(r.gia, await ma(r.gia))
        const gia = cacheGia.get(r.gia)!
        if (that === -1) { console.log(`  ? lạ   ${r.duong.padEnd(38)} không gọi được`); khongBiet++; continue }
        if (that === 404) { console.log(`  ✗ MẤT  ${r.duong.padEnd(38)} → ${r.vi}`); mat++; continue }
        if (gia === 404) { console.log(`  ✓ có   ${r.duong.padEnd(38)} (${that}, đường giả 404 → phân biệt được)`); co++; continue }
        console.log(`  · ?    ${r.duong.padEnd(38)} (${that}) — mount chặn xác thực trước, đường giả cũng ${gia}: KHÔNG kiểm được nếu không có PROD_TOKEN`)
        khongBiet++
    }
    console.log(`\n  ${co} route xác nhận CÓ · ${mat} MẤT · ${khongBiet} không kết luận được`)
    if (khongBiet > 0) console.log(`  → Kiểm hết: PROD_TOKEN=<token đăng nhập> PROD_ADMIN_KEY=$(gcloud secrets versions access latest --secret open-retail-admin-key --project kengi-tech) npm run check:prod`)
    /* MÃ THOÁT PHẢI NÓI THẬT (21/08/2026).
     * Trước đây hàm này LUÔN thoát 0 khi không có route nào MẤT — kể cả lúc chạy chay không token,
     * tức **không kiểm được gì cũng báo xanh**. Tài liệu phải dặn "đừng nhìn mã thoát", mà một
     * phép kiểm cần dặn như vậy thì không dùng làm cổng chặn được.
     * Nay: 0 = đã xác nhận HẾT · 1 = chắc chắn THIẾU code · 2 = KHÔNG KẾT LUẬN ĐƯỢC. */
    if (mat === 0 && khongBiet > 0) {
        console.log(`\n  ⛔ KHÔNG KẾT LUẬN ĐƯỢC cho ${khongBiet}/${co + mat + khongBiet} route — thiếu token nên`)
        console.log('     mount chặn ở tầng xác thực, không phân biệt được "route có" với "route mất".')
        console.log('     Đây KHÔNG phải "đạt". Muốn kết luận thì chạy lại kèm PROD_TOKEN / PROD_ADMIN_KEY.')
        process.exit(2)
    }
    if (mat > 0) {
        console.log(`\n  ⚠ Prod THIẾU code. Đã gặp: deploy từ cây khác / CI build HEAD / deploy lại image cũ.`)
        console.log(`  ⚠ Nặng nhất: mất bản vá "thiếu ≠ 0" ⇒ webhook KiotViet ghi 0 lên nợ thật (xem memory hai-cay-deploy-de-nhau).`)
        process.exit(1)
    }
}

main().catch(e => { console.error('  lỗi:', e?.message || e); process.exit(1) })
