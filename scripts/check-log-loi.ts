/**
 * Kiểm GHI LOG LỖI KHÔNG ĐƯỢC NUỐT NỘI DUNG — npx tsx scripts/check-log-loi.ts
 *
 * Nội suy một đối tượng lỗi vào chuỗi mẫu (`${err}` / `${err.message}`) là ép nó
 * thành chuỗi, và với lỗi Prisma thì **nội dung nằm ở `code`/`meta` còn
 * `.message` rỗng**. Tệ hơn: lỗi rỗng cả `name` lẫn `message` khiến
 * `String(err)` — tức `Error.prototype.toString()` — trả về CHUỖI RỖNG.
 *
 * DÍNH THẬT 16/08/2026: 8 dòng `[OrderSync] Error converting order SPE-…:` dài
 * đúng 55 ký tự, kết thúc bằng dấu hai chấm. Thủ phạm thật là cạn pool
 * (`connection limit: 1`), và chỉ tìm ra nhờ mấy dòng `prisma:error` nằm rời
 * bên cạnh. Trước đó mẫu này đã làm hàng trăm lỗi/ngày không chẩn được suốt
 * bốn ngày (12–15/08).
 *
 * ⚠ TRUYỀN LÀM ĐỐI SỐ RIÊNG THÌ KHÔNG SAO: `console.error('x:', err)` được Node
 * in đầy đủ cả stack. Đo 16/08: 75 chỗ dùng kiểu đó — hoàn toàn lành. Bộ kiểm
 * này CHỈ soi chuỗi mẫu, nếu không thì kêu 75 chỗ vô hại và sẽ bị bỏ qua.
 *
 * ⚠ VÀ PHẢI THA `data.message` CỦA PHẢN HỒI API. `[Shopee Escrow] ${data.message}`
 * là thông báo lỗi do sàn trả về, luôn có nội dung — không phải đối tượng lỗi.
 * Phân biệt bằng TÊN BIẾN gốc: err/e/error/ex/…Err mới là lỗi.
 *
 * Cách sửa: dùng `moTaLoi(err)` trong `src/lib/gomLoi.ts` — nó ghép
 * code|message|meta và có đường lùi lấy khung gọi từ stack khi mọi trường rỗng.
 */

import * as fs from 'fs'
import * as path from 'path'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

/** Tên biến trông như đối tượng lỗi: e, err, error, ex, vErr, convErr, roErr… */
export function laTenLoi(ten: string): boolean {
    return /^(e|err|error|ex|exc)\d*$/i.test(ten) || /err(or)?\d*$/i.test(ten)
}

/**
 * Tìm chỗ nội suy đối tượng lỗi vào chuỗi mẫu của console.
 * Trả về danh sách đoạn vi phạm (rỗng = sạch).
 */
export function timChoNuotLoi(ma: string): string[] {
    const ra: string[] = []
    // console.xxx(`…`) — chỉ lấy đối số đầu là chuỗi mẫu
    const re = /console\.(?:error|warn|log)\(\s*`([^`]*)`/g
    let m: RegExpExecArray | null
    while ((m = re.exec(ma)) !== null) {
        const chuoi = m[1]
        for (const noi of chuoi.matchAll(/\$\{([^}]*)\}/g)) {
            const bt = noi[1].trim()
            // Đã dùng moTaLoi/JSON.stringify thì thôi
            if (/moTaLoi|JSON\.stringify/.test(bt)) continue
            // `${err}` trần, hoặc `${err.message}` / `${err?.message}` (có thể kèm || …)
            const mBien = bt.match(/^([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)?\s*(message)?\s*(?:\|\||$)/)
            if (!mBien) continue
            const ten = mBien[1]
            if (!laTenLoi(ten)) continue          // data.message của sàn → tha
            ra.push(noi[0])
        }
    }
    return ra
}

function quetFile(d: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'generated') quetFile(p, ra) }
        else if (e.name.endsWith('.ts')) ra.push(p)
    }
    return ra
}

function main() {
    console.log('\n▶ Ghi log lỗi không được nuốt nội dung\n')

    const viPham: string[] = []
    let soConsole = 0
    for (const f of quetFile('src')) {
        const s = fs.readFileSync(f, 'utf8')
        soConsole += (s.match(/console\.(?:error|warn|log)\(\s*`/g) || []).length
        for (const v of timChoNuotLoi(s)) {
            const dong = s.slice(0, s.indexOf(v)).split('\n').length
            viPham.push(`${path.relative('src', f)}:${dong} → ${v}`)
        }
    }

    ok('không chỗ nào nội suy đối tượng lỗi vào chuỗi mẫu', viPham.length === 0, viPham)
    ok('bộ dò còn sống (có tìm thấy console dùng chuỗi mẫu)', soConsole >= 20, soConsole)

    // ── PHẢI BẮT: đúng những dòng đã hỏng thật ──────────────────────────────
    ok('bắt `${err.message}` — ca OrderSync 16/08',
        timChoNuotLoi('console.error(`[OrderSync] Error converting order ${o.n}: ${err.message}`)').length === 1)
    ok('bắt `${e?.message}`',
        timChoNuotLoi('console.warn(`[einvoice] lỗi: ${e?.message}`)').length === 1)
    ok('bắt `${err?.message || err}` — đường lùi cũng ra rỗng',
        timChoNuotLoi('console.warn(`[Sync] ${sid}: ${vErr?.message || vErr}`)').length === 1)
    ok('bắt `${err}` trần',
        timChoNuotLoi('console.warn(`[Shopee] ${sn}: ${err}${detail}`)').length === 1)
    ok('bắt tên biến kiểu convErr/roErr',
        timChoNuotLoi('console.warn(`x: ${convErr.message}`)').length === 1)

    // ── PHẢI IM: nếu kêu mấy ca này thì bộ kiểm thành tiếng ồn ─────────────
    ok('THA đối số riêng (Node in đủ stack)',
        timChoNuotLoi("console.error('[X] hỏng:', err?.message || err)").length === 0)
    ok('THA `${data.message}` của phản hồi sàn',
        timChoNuotLoi('console.warn(`[Shopee Escrow] ${orderSn}: ${data.error} - ${data.message}`)').length === 0)
    ok('THA `${docData.message}` của phản hồi TikTok',
        timChoNuotLoi('console.warn(`[TikTok AWB] failed: [${docData.code}] ${docData.message}`)').length === 0)
    ok('THA khi đã dùng moTaLoi',
        timChoNuotLoi('console.error(`[OrderSync] lỗi ${n}: ${moTaLoi(err)}`)').length === 0)
    ok('THA biến thường không phải lỗi',
        timChoNuotLoi('console.log(`đã xong ${count} đơn, ${store.name}`)').length === 0)

    // ── laTenLoi: đúng ranh giới ───────────────────────────────────────────
    ok('laTenLoi nhận err/e/vErr/convErr', ['err', 'e', 'vErr', 'convErr', 'roErr'].every(laTenLoi))
    ok('laTenLoi KHÔNG nhận data/docData/store', !['data', 'docData', 'store', 'count'].some(laTenLoi))

    console.log(`\n  Đã soi ${soConsole} chỗ console dùng chuỗi mẫu.`)
    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
