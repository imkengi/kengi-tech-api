/**
 * check:khoiphucno — SAU KHI DEPLOY + chạy khôi phục, kiểm 24 khách HUTI đã có nợ trở lại chưa.
 *
 * Bối cảnh 20/08/2026: máy chủ chạy ảnh cũ thiếu bản vá "thiếu ≠ 0", webhook `customer.update` của
 * KiotViet ghi 0 đè nợ thật → 24 khách mất tổng 1.264.231.175đ. Danh sách dưới đây chụp từ ảnh
 * ngày 18/08 (sau lần sửa trước), đối chiếu với hiện trạng 20/08.
 *
 * Bộ soát này KHÔNG tự sửa gì. Nó chỉ trả lời một câu: *đã lấy lại được chưa, còn thiếu ai.*
 *
 * Chạy (cần token đăng nhập cửa hàng HUTI vì /customers/* chặn xác thực ở mount):
 *   PROD_TOKEN=<token> npx tsx scripts/check-khoi-phuc-no.ts
 *   PROD_TOKEN=<token> BASE=https://api.kengi.vn/api npx tsx scripts/check-khoi-phuc-no.ts
 */
const BASE = process.env.BASE || 'https://api.kengi.vn/api'
const TOKEN = process.env.PROD_TOKEN || ''

/** mã khách → nợ ngày 18/08 (đồng) */
const NO_18_08: Record<string, number> = {
    HA01: 334_487_863, HA02: 322_849_056, PM35: 207_133_839, PC15: 142_867_396,
    PM48: 77_287_171, PM62: 23_461_414, HN07: 22_332_792, 'QN005.HU': 19_859_535,
    PM12: 19_698_292, TS32: 14_823_200, PC20: 14_679_762, PM09: 11_612_931,
}
/* Ghi chú: bảng trên là 12 khách LỚN NHẤT trong 24 khách (đủ để kết luận khôi phục có chạy hay
 * không). Danh sách đầy đủ 24 mã nằm ở DANH-SACH-KHACH-BI-XOA-NO-20-08.md trong scratchpad —
 * cố ý KHÔNG nhét hết vào code để tránh hai bản danh sách lệch nhau về sau. */

async function main() {
    if (!TOKEN) {
        console.error('Thiếu PROD_TOKEN — không có token thì /customers/segments-live trả 401 và bộ soát')
        console.error('sẽ tưởng "không khách nào có nợ". Đúng cái bẫy tối 20/08. Dừng ở đây.')
        process.exitCode = 2; return
    }
    const res = await fetch(`${BASE}/customers/segments-live`, { headers: { Authorization: 'Bearer ' + TOKEN } })
    if (!res.ok) {
        console.error(`Đọc không được (${res.status}) — KHÔNG kết luận gì về nợ. Kiểm token/máy chủ rồi chạy lại.`)
        process.exitCode = 2; return
    }
    const body: any = await res.json()
    const ds: any[] = body?.data || []
    if (!ds.length) {
        console.error('Máy chủ trả danh sách RỖNG — đọc được nhưng không có khách nào: bất thường, dừng.')
        process.exitCode = 2; return
    }
    const theoMa = new Map<string, any>(ds.map((x: any) => [String(x.code), x]))

    let daVe = 0, conThieu = 0, tienThieu = 0, khongThayMa = 0
    console.log('=== check:khoiphucno — 12 khách nợ lớn nhất trong nhóm bị xoá ===\n')
    for (const [ma, no18] of Object.entries(NO_18_08)) {
        const k = theoMa.get(ma)
        if (!k) { console.log(`  ? ${ma.padEnd(10)} không thấy mã trong danh sách trả về`); khongThayMa++; continue }
        const nay = Math.round(Number(k.debt) || 0)
        if (nay <= 0) {
            console.log(`  ✗ ${ma.padEnd(10)} vẫn 0đ  (18/08 là ${no18.toLocaleString('vi-VN')}đ) — ${k.name || ''}`)
            conThieu++; tienThieu += no18
        } else {
            const dau = nay >= no18 * 0.9 ? '✓' : '~'
            console.log(`  ${dau} ${ma.padEnd(10)} ${nay.toLocaleString('vi-VN').padStart(15)}đ (18/08: ${no18.toLocaleString('vi-VN')}đ)`)
            daVe++
        }
    }
    console.log(`\n${daVe} khách đã có nợ trở lại · ${conThieu} khách vẫn 0đ` +
        (tienThieu ? ` (còn thiếu ~${tienThieu.toLocaleString('vi-VN')}đ trong nhóm này)` : '') +
        (khongThayMa ? ` · ${khongThayMa} mã không thấy` : ''))
    if (conThieu) {
        console.log('\n→ Chạy: /api/admin/kiotviet-no-khach?storeCode=HUTI&all=1&apply=1 (cần x-admin-key)')
        console.log('  rồi chạy lại bộ soát này. Vẫn 0đ nghĩa là KiotViet cũng đang trả 0 — lúc đó phải hỏi KV.')
    }
    process.exitCode = conThieu ? 1 : 0
}

/* Dùng process.exitCode thay process.exit(): thoát ngay giữa lúc fetch còn treo làm Node trên
 * Windows ném assertion `UV_HANDLE_CLOSING` — thông báo lỗi giả ngay dưới câu kết luận thật. */
main().catch(e => { console.error('Lỗi chạy bộ soát:', e?.message || e); process.exitCode = 2 })
