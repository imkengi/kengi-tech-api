#!/usr/bin/env node
/**
 * SOÁT TRẦN CẮT ÂM THẦM TRONG CÔNG CỤ MCP
 *
 * Bệnh: tool cắt ở 20 dòng rồi trả về một danh sách trông hoàn chỉnh. AI đọc xong
 * TỰ CỘNG và nói "tổng nợ khách là 43 triệu" — trong khi đó là tổng của 20 khách
 * đầu tiên. Không lỗi nào nổ, con số vẫn tròn, chủ shop tin và ra quyết định.
 *
 * Ở giao diện web người ta còn thấy nút "xem thêm"; với AI thì không — nên đây là
 * chỗ bệnh này nguy hơn hẳn.
 *
 * LUẬT: tool nào có `take:` giới hạn một DANH SÁCH thì phải trả kèm cảnh báo khi
 * chạm trần — bằng `canhBaoCat()` (lib/mcpTypes.ts) hoặc một cờ tự viết.
 *
 * Chạy: npm run check:mcptran
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const THU_MUC = 'src/routes'

/* Tool CỐ Ý không cần cảnh báo. Mỗi dòng phải có lý do — đây là nơi người sau đọc
 * để biết "chỗ này bỏ qua có chủ đích", không phải chỗ giấu nợ. */
const MIEN = {
    record_debt_payment: 'take nhỏ để tra phiếu áp nợ, không trả danh sách cho AI đọc',
    accounting_chart_of_accounts: 'hệ thống tài khoản cố định vài trăm dòng, trần 1000 không thể chạm',
    accounting_account_balance: 'trần 100.000 bút toán — chạm là dữ liệu đã hỏng, không phải phân trang',
    marketing_save_draft: 'take dùng để đánh số bản nháp, không phải danh sách trả về',

    /* ─── TOP-N: trần LÀ Ý ĐỒ, không phải cắt ──────────────────────────────────
     * Tool kiểu "5 hàng bán chạy nhất" LUÔN trả đúng N, nên cảnh báo sẽ nổ ở MỌI
     * lượt gọi — thành nhiễu, mà nhiễu thì dạy model bỏ qua cảnh báo ở cả những
     * chỗ thật sự cần.
     *
     * Quan trọng hơn: tổng của mấy tool này lấy từ aggregate/groupBy chạy trên
     * TOÀN BỘ dữ liệu nên tổng vẫn đúng — dán câu "tổng thấp hơn thực tế" vào là
     * nói sai về một con số đang đúng, rồi đẩy AI đi tự cộng lại từ danh sách đã
     * cắt. Hỏng đúng thứ đang lành. */
    sales_report: 'take:5 = top 5 hàng bán chạy; tổng doanh thu lấy từ aggregate nên đúng',
    expense_report: 'take:10 = 10 khoản chi lớn nhất; tổng lấy từ groupBy nên đúng',
    top_customers: 'top-N khách theo chi tiêu — trần là ý đồ, luôn trả đủ N',
    marketing_content_material: 'lấy vài mặt hàng mỗi nhóm làm nguyên liệu viết bài, không ai cộng tổng trên nó',
}

/** Dấu hiệu tool CÓ báo cắt: gọi helper chung, hoặc tự so sánh rồi trả cờ ra. */
const CO_BAO = /canhBaoCat\s*[:(]|canhBaoMau\s*\(|\bbiCat\w*|\bchamTran\w*|\bconNua\w*|truncated|capped/

/** `take:` có khả năng cắt danh sách. Bỏ qua `take: 1` (lấy một bản ghi). */
const CO_CAT = /\btake:\s*(?!1\b)(\d+|[A-Za-z_$][\w$.]*\s*\(|[A-Z_][A-Z_0-9]*|\w+)/

const KHOI = /\n\s+name: '([a-z_]+)',\n([\s\S]*?)(?=\n\s+name: '[a-z_]+',\n|$)/g

const thieu = []
const mienThua = new Set(Object.keys(MIEN))
let soTool = 0
let soCat = 0
let soBao = 0

for (const ten of readdirSync(THU_MUC)) {
    if (!ten.startsWith('mcp') || !ten.endsWith('.ts')) continue

    /* CHUẨN HOÁ XUỐNG DÒNG TRƯỚC KHI KHỚP. Repo này có cả file LF lẫn CRLF (git tự
     * đổi khi commit trên Windows). Node đọc nguyên xi ký tự CR, không như Python
     * tự chuyển về LF — nên mẫu khớp theo LF trượt sạch trên file CRLF và bộ soát
     * âm thầm chỉ thấy 47/104 công cụ, tức bỏ lọt hơn nửa. Dính đúng lỗi này ngày
     * 05/09/2026, phát hiện được chỉ vì có một phép đếm thứ hai viết bằng Python
     * để đối chiếu. */
    const noiDung = readFileSync(join(THU_MUC, ten), 'utf8').split('\r\n').join('\n')

    for (const m of noiDung.matchAll(KHOI)) {
        const [, tool, than] = m
        soTool++
        if (!CO_CAT.test(than)) continue
        soCat++
        mienThua.delete(tool)
        if (tool in MIEN) continue
        if (CO_BAO.test(than)) { soBao++; continue }
        thieu.push({ tool, file: ten, tran: (than.match(CO_CAT) || [])[1] })
    }
}

console.log(`\n  Công cụ MCP: ${soTool} · có cắt trần: ${soCat} · đã báo cắt: ${soBao} · miễn có khai: ${Object.keys(MIEN).length - mienThua.size}`)

if (mienThua.size) {
    console.log('\n  ⚠ MIEN thừa (tool không còn cắt trần, hoặc đã đổi tên) — dọn đi:')
    for (const t of mienThua) console.log(`   · ${t}`)
}

if (thieu.length) {
    console.log(`\n  ✗ ${thieu.length} công cụ CẮT ÂM THẦM — AI sẽ cộng trên dữ liệu thiếu mà không biết:\n`)
    for (const t of thieu) {
        console.log(`   ${t.tool.padEnd(30)} trần=${String(t.tran).padEnd(18)} ${t.file}`)
    }
    console.log(`
   Sửa: trải cảnh báo vào ĐẦU object trả về —
       import { canhBaoCat } from '../lib/mcpTypes'
       return { ...canhBaoCat(ds.length, <trần>, 'khách nợ'), soKhachNo: ds.length, ... }
   Cố ý không cần thì khai vào MIEN trong scripts/check-mcp-tran.mjs kèm lý do.
`)
    process.exit(1)
}

console.log('\n  ✓ Mọi công cụ có cắt trần đều báo cho AI biết là đã cắt.\n')
