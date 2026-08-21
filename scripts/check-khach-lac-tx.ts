/**
 * check:khachlactx — bắt DÙNG CLIENT NGOÀI bên trong `$transaction`.
 *
 * Vì sao chết người ở đây: prod đặt `PRISMA_POOL_SIZE=1`. Khi `$transaction` chạy, nó GIỮ kết nối
 * duy nhất đó. Nếu trong thân transaction lại gọi `prisma.x.y()` (client toàn cục) thay vì `tx.x.y()`,
 * lời gọi kia xếp hàng chờ một kết nối sẽ **không bao giờ** được nhả — vì người đang giữ nó lại đứng
 * chờ chính lời gọi này. Kết quả là **treo tới timeout**, không phải chậm, và log không có dòng lỗi.
 *
 * Liên quan trực tiếp tới đêm 20→21/08/2026: ba chỗ (expenses / payroll / importReceipts) vừa được
 * gom nghiệp vụ + ghi sổ vào CÙNG một `$transaction`. Các hàm ghi sổ nhận client qua tham số TÊN LÀ
 * `prisma`, nên nhìn lướt giống hệt lời gọi toàn cục — đúng loại nhầm mà mắt người bỏ qua.
 *
 * Quy tắc: chỉ soi khi tham số callback KHÔNG tên `prisma`. Nếu nó tên `prisma` thì đã che biến
 * ngoài, dùng `prisma.` bên trong là ĐÚNG (và đó chính là cách các hàm ghi sổ ở đây đang làm).
 *
 * Đây là phép soi THEO CHUỖI: nó không lần được client đi qua hàm con. Xanh nghĩa là "không thấy
 * chỗ gọi trực tiếp", không phải "chắc chắn không treo".
 *
 * Chạy: npm run check:khachlactx
 */
import fs from 'fs'
import path from 'path'

const GOC = path.resolve(__dirname, '../src')

function quet(d: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'generated') quet(p, ra) }
        else if (e.name.endsWith('.ts')) ra.push(p)
    }
    return ra
}

const tenGon = (f: string) => path.relative(GOC, f).split(path.sep).join('/')

const loi: string[] = []
const dsFile = quet(GOC)
for (const f of dsFile) {
    const dong = fs.readFileSync(f, 'utf8').split('\n')
    for (let i = 0; i < dong.length; i++) {
        const m = dong[i].match(/\$transaction\(\s*async\s*\(\s*([A-Za-z_$][\w$]*)/)
        if (!m) continue
        const bien = m[1]
        if (bien === 'prisma') continue          // đã che biến ngoài — `prisma.` bên trong là đúng

        /* Ước lượng thân transaction bằng đếm ngoặc nhọn (dừng khi cân bằng trở lại). */
        let sau = 0, het = Math.min(dong.length - 1, i + 200)
        for (let j = i; j <= het; j++) {
            for (const c of dong[j]) { if (c === '{') sau++; else if (c === '}') sau-- }
            if (j > i && sau <= 0) { het = j; break }
        }

        for (let j = i + 1; j <= het; j++) {
            /* `prisma.` trần: không đứng sau chữ/dấu chấm (tránh bắt `tx.prisma`, `this.prisma`). */
            if (!/(?<![\w$.])prisma\s*\.\s*[A-Za-z_$]/.test(dong[j])) continue
            loi.push([
                `${tenGon(f)}:${j + 1}`,
                `      dùng \`prisma.\` trong $transaction (tham số tên là \`${bien}\`) → treo ở pool=1`,
                `      ${dong[j].trim().slice(0, 100)}`,
            ].join('\n'))
        }
    }
}

console.log('=== check:khachlactx — client toàn cục lọt vào thân $transaction ===\n')
if (loi.length) {
    console.log(`❌ ${loi.length} chỗ sẽ TREO trên prod (PRISMA_POOL_SIZE=1):`)
    for (const l of loi) console.log('   - ' + l)
    console.log('\n→ Sửa: đổi `prisma.` thành tên tham số của callback, hoặc truyền tham số đó xuống hàm con.')
    process.exit(1)
}
console.log(`✅ Không có client ngoài nào lọt vào thân $transaction. — đã soi ${dsFile.length} file.`)
if (!dsFile.length) { console.log('⛔ NHƯNG SOI 0 FILE — đường quét hỏng, KHÔNG kết luận được.'); process.exit(2) }
console.log('   (Phép soi theo chuỗi — không lần được client truyền qua hàm con.)')
