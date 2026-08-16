/**
 * Kiểm THAM SỐ CỦA chayTheoDot — npx tsx scripts/check-chay-theo-dot.ts
 *
 * `chayTheoDot([...])` gọi `f()` trên TỪNG phần tử để tự giới hạn số truy vấn
 * chạy cùng lúc (pool mỗi cửa hàng chỉ vài kết nối). Truyền promise thay vì hàm
 * là gọi promise như hàm → `TypeError: f is not a function` → endpoint 500 với
 * MỌI request.
 *
 * DÍNH THẬT 16/08/2026: phần tử thứ năm của `GET /customers/segments-live` là
 * `(prisma as any).$queryRawUnsafe(...)` — một promise. Trang Phân Khúc trắng ở
 * MỌI cửa hàng, 24 lần lỗi 500 chỉ trong 2 giờ, và chủ shop tưởng là "không có
 * dữ liệu" chứ không biết nó đang hỏng.
 *
 * ⚠ TYPESCRIPT KHÔNG BẮT ĐƯỢC. Chữ ký nhận `readonly (() => PromiseLike<any>)[]`,
 * nhưng `(prisma as any).…` là kiểu `any`, mà `any` gán được vào KIỂU HÀM. Nên
 * phải soi bằng văn bản.
 *
 * Bỏ chú thích trước khi tách phần tử: docblock của chính poolGuard.ts có ví dụ
 * `* () => prisma.customer.count()` và sẽ bị đếm nhầm thành phần tử.
 */

import * as fs from 'fs'
import * as path from 'path'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

function quetFile(d: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'generated') quetFile(p, ra) }
        else if (e.name.endsWith('.ts')) ra.push(p)
    }
    return ra
}

/** Bỏ chú thích khối và chú thích dòng — chúng chứa ví dụ mã, đếm vào là báo nhầm. */
export function boChuThich(t: string): string {
    return t.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
}

/** Tách phần tử cấp 1 của một mảng (không đi vào ngoặc lồng). */
export function tachPhanTu(khoi: string): string[] {
    const ra: string[] = []
    let sau = 0, cur = ''
    for (const ch of khoi) {
        if ('([{'.includes(ch)) sau++
        if (')]}'.includes(ch)) sau--
        if (ch === ',' && sau === 0) { ra.push(cur); cur = '' }
        else cur += ch
    }
    if (cur.trim()) ra.push(cur)
    return ra.map(x => x.trim()).filter(Boolean)
}

/** Phần tử hợp lệ: `() => …`, `x => …`, hoặc ba ngôi mà MỌI nhánh đều là hàm. */
export function laHam(pt: string): boolean {
    if (/^\(\s*\)\s*=>/.test(pt)) return true
    if (/^[\w{[]+\s*=>/.test(pt)) return true
    // Ba ngôi: đếm số nhánh và số mũi tên đứng ngay sau ? hoặc :
    if (pt.includes('?')) {
        const nhanh = (pt.match(/[?:]\s*\(\s*\)\s*=>/g) || []).length
        if (nhanh >= 2) return true
    }
    return false
}

function main() {
    console.log('\n▶ Tham số của chayTheoDot phải là HÀM, không phải promise\n')

    const viPham: string[] = []
    let soCho = 0
    for (const f of quetFile('src')) {
        /* Lọc chú thích TRƯỚC khi tìm, không phải sau.
         * Docblock của poolGuard.ts chứa nguyên ví dụ `chayTheoDot([`; tìm trên
         * văn bản gốc rồi mới lọc đoạn cắt ra thì đoạn đó nằm giữa chú thích,
         * không có dấu đóng, nên lọc không ăn và ví dụ bị đếm thành mã thật. */
        const s = boChuThich(fs.readFileSync(f, 'utf8'))
        const re = /chayTheoDot\s*\(\s*\[/g
        let m: RegExpExecArray | null
        while ((m = re.exec(s)) !== null) {
            let i = m.index + m[0].length, sau = 1, j = i
            while (j < s.length && sau > 0) { if (s[j] === '[') sau++; else if (s[j] === ']') sau--; j++ }
            const khoi = s.slice(i, j - 1)
            if (!khoi.trim()) continue          // toàn chú thích → là docblock
            soCho++
            const xau = tachPhanTu(khoi).filter(x => !laHam(x))
            const dong = s.slice(0, m.index).split('\n').length
            for (const x of xau) viPham.push(`${path.relative('src', f)}:${dong} → ${x.replace(/\s+/g, ' ').slice(0, 70)}`)
        }
    }

    ok('mọi phần tử truyền cho chayTheoDot đều là hàm', viPham.length === 0, viPham)
    ok('có thật sự tìm thấy chỗ gọi để kiểm (bộ dò còn sống)', soCho >= 5, soCho)

    // Chiều ngược: phải BẮT được promise truyền thẳng
    const gia = tachPhanTu(`() => a.b(), (prisma as any).$queryRawUnsafe('x')`).filter(x => !laHam(x))
    ok('bắt được promise truyền thẳng', gia.length === 1, gia)

    // Và KHÔNG bắt nhầm ba ngôi mà cả hai nhánh đều là hàm
    const that = tachPhanTu(`co ? () => a() : () => Promise.resolve([])`).filter(x => !laHam(x))
    ok('không bắt nhầm ba ngôi toàn hàm', that.length === 0, that)

    // Và PHẢI bắt ba ngôi có một nhánh là promise (đúng ca 16/08)
    const nua = tachPhanTu(`co ? (p as any).$queryRawUnsafe('x') : Promise.resolve([])`).filter(x => !laHam(x))
    ok('bắt được ba ngôi mà nhánh là promise', nua.length === 1, nua)

    console.log(`\n  Đã soi ${soCho} chỗ gọi chayTheoDot.`)
    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
