/**
 * SOÁT BẮN SONG SONG TRUY VẤN VÀO POOL NHỎ CỦA CỬA HÀNG.
 *
 * Chạy:  npx tsx scripts/check-pool.ts
 *
 * VÌ SAO CÓ FILE NÀY
 * Mỗi cửa hàng có pool kết nối rất nhỏ (PRISMA_POOL_SIZE=8, có store còn 3).
 * Một `Promise.all` gom 4-5 truy vấn nghĩa là MỘT lượt xem trang chiếm ngần ấy
 * kết nối cùng lúc. Hai người mở trang đó, hoặc đúng lúc cron đang chạy, là cạn
 * pool: các request khác chờ tới timeout rồi trả 500 — và lỗi hiện ra ở NHỮNG
 * TRANG KHÁC chứ không phải trang gây ra, nên rất khó lần.
 *
 * Đã xảy ra thật và được ghi lại trong ghi chú dự án: "1 trang ngốn 3-4 kết nối
 * → đụng cron là cạn pool 500/sập; route mới phải chạy tuần tự".
 *
 * Chạy tuần tự chậm hơn vài trăm mili giây. Sập pool thì cả cửa hàng đứng.
 *
 * NGƯỠNG
 * 2 truy vấn song song thì chấp nhận được. Từ 3 trở lên là bắt đầu ăn vào phần
 * dự phòng của pool — đó là ngưỡng cảnh báo.
 *
 * CÁCH BỎ QUA CÓ CHỦ Ý
 * Ghi `// pool-co-y: <lý do>` ngay trước `Promise.all`. Ví dụ hợp lệ: chạy trên
 * registry (pool riêng, không phải pool cửa hàng), hoặc các lời gọi không phải
 * truy vấn DB.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const GOC = join(__dirname, '..')
const THU_MUC = ['src/routes', 'src/lib', 'src/cron', 'src/services']
/* HAI MỨC, chứ không một.
 *
 * Repo đang có ~27 chỗ bắn từ 3 truy vấn — chặn hết ngay thì bộ kiểm đỏ vĩnh
 * viễn, mà bộ kiểm đỏ mãi thì người ta thôi đọc nó, và lúc đó nó vô dụng hơn cả
 * việc không có. Nên: CHẶN cái thật sự nguy hiểm, LIỆT KÊ cái cần dọn dần.
 *
 * Hạ dần ngưỡng chặn khi danh sách ngắn lại. */
const NGUONG_CHAN = 6
const NGUONG_NHAC = 3
const CHO_PHEP_BO_QUA = 'pool-co-y'

interface ViPham { file: string; dong: number; so: number; ham: string }

function moiFileTs(thuMuc: string): string[] {
    const ra: string[] = []
    const duyet = (d: string) => {
        let ds: string[]
        try { ds = readdirSync(d) } catch { return }
        for (const ten of ds) {
            const p = join(d, ten)
            let st
            try { st = statSync(p) } catch { continue }
            if (st.isDirectory()) {
                if (['node_modules', 'generated', '__tests__'].includes(ten)) continue
                duyet(p)
            } else if (ten.endsWith('.ts') && !ten.endsWith('.d.ts')) ra.push(p)
        }
    }
    duyet(join(GOC, thuMuc))
    return ra
}

/** Lấy trọn khối từ dấu mở ngoặc tới khi cân bằng. */
function layKhoi(s: string, i: number): string {
    let sau = 0
    for (let j = i; j < s.length && j < i + 8000; j++) {
        const c = s[j]
        if (c === '(' || c === '[' || c === '{') sau++
        else if (c === ')' || c === ']' || c === '}') {
            sau--
            if (sau === 0) return s.slice(i, j + 1)
        }
    }
    return ''
}

const TRUY_VAN = /(?:prisma|storePrisma|sp|p|tx|db)\s*\.\s*(?:[a-zA-Z]+\s*\.\s*(?:findMany|findFirst|findUnique|aggregate|groupBy|count|updateMany|deleteMany)|\$queryRaw|\$queryRawUnsafe|\$executeRaw)/g

/** Tên hàm/route gần nhất phía trên — để người đọc biết ngay chỗ nào. */
function tenGan(s: string, i: number): string {
    const truoc = s.slice(Math.max(0, i - 2000), i)
    const m = [...truoc.matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]|(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)]
    if (m.length === 0) return ''
    const cuoi = m[m.length - 1]
    return cuoi[2] ? `${cuoi[1].toUpperCase()} ${cuoi[2]}` : (cuoi[3] || '')
}

function soat(): { viPham: ViPham[]; tong: number } {
    const viPham: ViPham[] = []
    let tong = 0
    for (const tm of THU_MUC) {
        for (const file of moiFileTs(tm)) {
            const src = readFileSync(file, 'utf8')
            const re = /Promise\.all\s*\(/g
            let m: RegExpExecArray | null
            while ((m = re.exec(src)) !== null) {
                const khoi = layKhoi(src, m.index + m[0].length - 1)
                if (!khoi) continue
                TRUY_VAN.lastIndex = 0
                const so = (khoi.match(TRUY_VAN) || []).length
                if (so >= 2) tong++
                if (so < NGUONG_NHAC) continue

                const truoc = src.slice(Math.max(0, m.index - 300), m.index)
                if (truoc.includes(CHO_PHEP_BO_QUA)) continue

                viPham.push({
                    file: relative(GOC, file).replace(/\\/g, '/'),
                    dong: src.slice(0, m.index).split('\n').length,
                    so,
                    ham: tenGan(src, m.index),
                })
            }
        }
    }
    return { viPham, tong }
}

function main() {
    console.log('Soát bắn song song truy vấn vào pool cửa hàng')
    console.log(`  quét ${THU_MUC.join(', ')} · chặn từ ${NGUONG_CHAN}, nhắc từ ${NGUONG_NHAC}`)
    const { viPham, tong } = soat()
    console.log(`  ${tong} chỗ Promise.all gom từ 2 truy vấn trở lên`)

    viPham.sort((a, b) => b.so - a.so)
    const chan = viPham.filter(v => v.so >= NGUONG_CHAN)
    const nhac = viPham.filter(v => v.so < NGUONG_CHAN)

    if (nhac.length > 0) {
        console.log(`\n⚠️  ${nhac.length} chỗ bắn ${NGUONG_NHAC}-${NGUONG_CHAN - 1} truy vấn — nên dọn dần, chưa chặn:`)
        for (const v of nhac) {
            console.log(`     ${v.so} · ${v.file}:${v.dong}${v.ham ? `  (${v.ham})` : ''}`)
        }
    }

    if (chan.length === 0) {
        console.log(`\n✅ Không chỗ nào bắn từ ${NGUONG_CHAN} truy vấn song song.\n`)
        return
    }

    console.log(`\n❌ ${chan.length} chỗ bắn từ ${NGUONG_CHAN} truy vấn song song:\n`)
    for (const v of chan) {
        console.log(`  ✗ ${v.so} truy vấn · ${v.file}:${v.dong}${v.ham ? `  (${v.ham})` : ''}`)
    }
    console.log(`
  Sửa: chạy TUẦN TỰ (await từng cái), hoặc gộp thành một truy vấn.
  Cố ý bắn song song thì ghi // ${CHO_PHEP_BO_QUA}: <lý do> ngay trước Promise.all.

  Pool mỗi cửa hàng chỉ 3-8 kết nối. Chạy tuần tự chậm hơn vài trăm mili giây;
  cạn pool thì cả cửa hàng đứng, và lỗi 500 hiện ở NHỮNG TRANG KHÁC chứ không
  phải trang gây ra.
`)
    process.exit(1)
}

main()
