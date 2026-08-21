/**
 * check:kieu — chạy `tsc --noEmit` nhưng CHỈ đỏ với lỗi MỚI.
 *
 * Vì sao (20/08/2026): `npm run build` dùng esbuild — nó **không kiểm kiểu**. Tối nay tôi hai lần
 * viết code dùng biến chưa khai/chưa import (`loiDocHd`, rồi `moTaLoi`) mà build vẫn xanh; cái đầu
 * lộ ra nhờ bộ ca kiểm, cái sau nhờ đọc lại tay. Cả hai đều là **ReferenceError lúc chạy** — nghĩa
 * là 500 ngay giữa nghiệp vụ tiền bạc, đúng lúc nhánh catch đó được kích hoạt.
 *
 * `tsc` đầy đủ đang có 20 lỗi CŨ ở 3 file (thiếu @types/ws…). Bắt sửa hết mới cho chạy thì không ai
 * chạy. Nên: ghi 3 file đó vào NEN (baseline) kèm lý do, mọi lỗi ngoài danh sách là ĐỎ.
 *
 * Chạy: npm run check:kieu
 */
import { execSync } from 'child_process'

/** File còn lỗi kiểu CŨ — kèm lý do, để sau này ai dọn thì xoá khỏi đây. */
/* NỀN GIỜ RỖNG (21/08/2026) — cả hai mục cũ đã sửa dứt điểm:
 *   · websocket.ts: cài `@types/ws` ⇒ 16 lỗi về 0
 *   · chat.ts: ép kiểu conversationId ⇒ 1 lỗi về 0
 * Để rỗng CÓ CHỦ Ý: mọi lỗi kiểu từ nay đều là lỗi MỚI và phải sửa, không có chỗ nấp.
 * Thêm mục vào đây là NỚI bộ chặn — chỉ làm khi thật sự không sửa được, và phải ghi lý do. */
const NEN: Record<string, string> = {}

let ra = ''
try {
    execSync('npx tsc --noEmit -p tsconfig.json', { encoding: 'utf8', stdio: 'pipe' })
} catch (e: any) {
    ra = String(e?.stdout || '') + String(e?.stderr || '')
}

const dong = ra.split('\n').filter(l => /error TS\d+/.test(l))
const moi = dong.filter(l => {
    const f = l.split('(')[0].replace(/\\/g, '/').trim()
    return !Object.keys(NEN).some(n => f.endsWith(n))
})

console.log('=== check:kieu — lỗi kiểu MỚI (build bằng esbuild không kiểm kiểu) ===\n')
console.log(`   tsc báo ${dong.length} lỗi, trong đó ${dong.length - moi.length} thuộc nền đã khai.`)
if (moi.length) {
    console.error(`\n❌ ${moi.length} lỗi kiểu MỚI:`)
    for (const l of moi.slice(0, 30)) console.error('   ' + l.trim().slice(0, 160))
    console.error('\n   Lỗi hay gặp nhất: dùng biến/hàm chưa import (ReferenceError lúc chạy, build vẫn xanh).')
} else {
    console.log('\n✅ Không có lỗi kiểu mới ngoài phần nền.')
}
for (const [f, ly] of Object.entries(NEN)) console.log(`   · nền ${f}: ${ly}`)
process.exit(moi.length ? 1 : 0)
