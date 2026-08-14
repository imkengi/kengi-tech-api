/**
 * SOÁT QUY ĐỔI MÚI GIỜ KHI CẮT NGÀY TRONG SQL.
 *
 * Chạy:  npx tsx scripts/check-timezone.ts
 *
 * VÌ SAO CÓ FILE NÀY
 * Máy chủ chạy UTC, cửa hàng bán theo giờ Việt Nam (UTC+7). Cắt ngày thẳng từ
 * cột thời gian — `"createdAt"::date`, `to_char("createdAt",'YYYY-MM-DD')`,
 * `date_trunc('day', "createdAt")` — là gom theo NGÀY UTC.
 *
 * Hậu quả: mọi đơn bán trước 07:00 giờ VN rơi sang NGÀY HÔM TRƯỚC. Doanh thu
 * ngày nào cũng có, biểu đồ vẫn đẹp, tổng cả tháng vẫn đúng — chỉ có ranh giới
 * ngày là sai. Không có lỗi nào hiện ra, và người dùng chỉ phát hiện khi đối
 * chiếu tay với sổ giấy rồi thấy "hôm qua bán được mấy đơn sáng của hôm nay".
 *
 * Với cửa hàng mở cửa từ 6-7 giờ sáng thì phần bị đẩy nhầm là đáng kể.
 *
 * CÁCH VIẾT ĐÚNG
 *   ("createdAt" + interval '7 hours')::date
 *   ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 *
 * CÁCH BỎ QUA CÓ CHỦ Ý
 * Ghi `-- mui-gio-co-y: <lý do>` hoặc `// mui-gio-co-y: <lý do>` ngay trước.
 * Có chỗ dùng ngày UTC là đúng (so với mốc do chính hệ thống sinh ra theo UTC).
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const GOC = join(__dirname, '..')
const THU_MUC = ['src/lib', 'src/routes', 'src/cron', 'src/services']
const CHO_PHEP_BO_QUA = 'mui-gio-co-y'

interface ViPham { file: string; dong: number; trich: string; kieu: string }

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
                if (ten === 'node_modules' || ten === 'generated' || ten === '__tests__') continue
                duyet(p)
            } else if (ten.endsWith('.ts') && !ten.endsWith('.d.ts')) ra.push(p)
        }
    }
    duyet(join(GOC, thuMuc))
    return ra
}

/* SQL nằm trong chuỗi TS nên dấu ngoặc kép bị thoát: `t.\"createdAt\"`. Không bỏ
 * gạch chéo trước khi so thì mọi bộ lọc dưới đây đều trượt — và công cụ sẽ báo
 * "sạch" một cách yên tâm giả. Bản đầu đã dính đúng lỗi này. */
const sach = (s: string) => s.replace(/\\/g, '')

/** Biểu thức đã quy đổi sang giờ VN chưa? */
const daQuyDoi = (raw: string) => {
    const s = sach(raw)
    return /interval\s*'7\s*hours?'/i.test(s) ||
        /AT\s+TIME\s+ZONE\s*'Asia\/Ho_Chi_Minh'/i.test(s) ||
        /\+07|\+ 7 \* 3600|VN_OFFSET/i.test(s)
}

/** Biểu thức có đụng cột thời gian của DB không? Tránh bắt nhầm `$1::date`. */
const coCotThoiGian = (raw: string) => {
    const s = sach(raw)
    // Cột có thể để trong ngoặc kép hoặc trần (Expense.date), có hoặc không bí danh
    return /"?[A-Za-z_]*(At|Date)"?\b/.test(s) && !/^\s*\$\d/.test(s)
        ? /(createdAt|updatedAt|deliveredAt|paidAt|transactionDate|invoiceDate|\bdate\b|[A-Za-z_]+At)\b/.test(s)
        : false
}

const MAU: Array<{ ten: string; re: RegExp; layBieuThuc: (m: RegExpExecArray) => string }> = [
    {
        ten: 'to_char(..., YYYY-MM-DD)',
        re: /to_char\s*\(([^,]{1,120}),\s*'YYYY-MM-DD'/gi,
        layBieuThuc: m => m[1],
    },
    {
        /* Đơn vị gom KHÔNG được bám cứng vào 'day': nhiều chỗ truyền biến
         * (`date_trunc('${bucketUnit}', …)`). Bản đầu chỉ dò 'day' nên bỏ lọt
         * đúng chỗ nguy hiểm nhất — báo cáo tài chính gom theo tháng, đơn sáng
         * ngày 1 rơi sang THÁNG TRƯỚC chứ không chỉ lệch một ngày. */
        ten: 'date_trunc(...)',
        re: /date_trunc\s*\(\s*[^,]{1,40},\s*([^)]{1,120})\)/gi,
        layBieuThuc: m => m[1],
    },
    {
        /* Chỉ bắt ::date đứng ngay sau một cột hoặc sau ngoặc đóng — `$1::date`
         * và `'2026-01-01'::date` là ép kiểu tham số, hoàn toàn bình thường. */
        ten: '::date',
        re: /((?:[a-z]\.)?"[A-Za-z_]+"|\)[^;]{0,3})\s*::\s*date/gi,
        layBieuThuc: m => m[1],
    },
]

function soat(): ViPham[] {
    const viPham: ViPham[] = []
    for (const tm of THU_MUC) {
        for (const file of moiFileTs(tm)) {
            const src = readFileSync(file, 'utf8')
            for (const mau of MAU) {
                mau.re.lastIndex = 0
                let m: RegExpExecArray | null
                while ((m = mau.re.exec(src)) !== null) {
                    const bt = mau.layBieuThuc(m)
                    /* Với `)::date` phải soi ngược lên tìm ngoặc mở tương ứng —
                     * phần quy đổi nằm bên trong ngoặc chứ không nằm ở cụm khớp. */
                    const quanh = src.slice(Math.max(0, m.index - 220), m.index + 60)
                    if (daQuyDoi(bt) || daQuyDoi(quanh)) continue
                    if (!coCotThoiGian(bt) && !coCotThoiGian(quanh)) continue

                    const truoc = src.slice(Math.max(0, m.index - 400), m.index)
                    if (truoc.includes(CHO_PHEP_BO_QUA)) continue

                    viPham.push({
                        file: relative(GOC, file).replace(/\\/g, '/'),
                        dong: src.slice(0, m.index).split('\n').length,
                        trich: src.slice(m.index, m.index + 70).replace(/\s+/g, ' ').trim(),
                        kieu: mau.ten,
                    })
                }
            }
        }
    }
    // Một vị trí có thể khớp nhiều mẫu — gộp lại cho gọn.
    const thay = new Set<string>()
    return viPham.filter(v => {
        const k = `${v.file}:${v.dong}`
        if (thay.has(k)) return false
        thay.add(k)
        return true
    })
}

function main() {
    console.log('Soát quy đổi múi giờ khi cắt ngày trong SQL')
    console.log(`  quét ${THU_MUC.join(', ')}`)
    const viPham = soat()

    if (viPham.length === 0) {
        console.log('\n✅ Mọi phép cắt ngày trong SQL đều quy đổi sang giờ Việt Nam.\n')
        return
    }

    console.log(`\n❌ ${viPham.length} chỗ cắt ngày theo giờ UTC:\n`)
    for (const v of viPham) {
        console.log(`  ✗ ${v.file}:${v.dong}  [${v.kieu}]`)
        console.log(`      ${v.trich}`)
    }
    console.log(`
  Sửa: ("createdAt" + interval '7 hours')::date
  Cố ý dùng ngày UTC thì ghi -- ${CHO_PHEP_BO_QUA}: <lý do> ngay trước.

  Đơn bán trước 07:00 giờ VN sẽ rơi sang NGÀY HÔM TRƯỚC. Tổng tháng vẫn đúng,
  biểu đồ vẫn đẹp, chỉ ranh giới ngày là sai — không có lỗi nào hiện ra.
`)
    process.exit(1)
}

main()
