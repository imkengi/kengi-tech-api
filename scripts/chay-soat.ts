/**
 * chay-soat — chạy TOÀN BỘ bộ soát song song, in gọn.
 *
 * Vì sao (20/08/2026): `check:all` chạy tuần tự 18 mục, mỗi mục là một tiến trình `npx tsx`
 * riêng — đo được **114 giây**. Bộ soát chậm tới mức người ta bỏ chạy thì nó bằng không có.
 * Các bộ soát trong `check:all` đều THUẦN (chỉ đọc file + tính toán, không đụng DB, không gọi
 * mạng — `check:db`, `check:prod` cố tình KHÔNG nằm trong danh sách), nên chạy song song an toàn.
 *
 * Vẫn giữ nguyên ý nghĩa mã thoát: có mục nào hỏng thì exit 1.
 *
 * Chạy: npm run check:all        (đã trỏ vào đây)
 *       npx tsx scripts/chay-soat.ts --tuan-tu   (chạy tuần tự khi cần đọc log theo thứ tự)
 */
import { spawn } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'

const GOC = path.resolve(__dirname, '..')
const TUAN_TU = process.argv.includes('--tuan-tu')

/** Đọc thẳng từ package.json để danh sách không bao giờ lệch với `check:*` thật. */
const pkg = JSON.parse(fs.readFileSync(path.join(GOC, 'package.json'), 'utf8'))
const DANH_SACH: string[] = String(pkg.scripts['check:all-goc'] || '')
    .split('&&').map(s => s.trim().replace(/^npm run /, '')).filter(Boolean)

if (!DANH_SACH.length) {
    console.error('[chay-soat] Không đọc được `check:all-goc` trong package.json — đó mới là danh sách thật.')
    process.exit(2)
}

type KetQua = { ten: string; ma: number; ra: string; giay: number }

function chay(ten: string): Promise<KetQua> {
    return new Promise(res => {
        const batDau = Date.now()
        const lenh = String(pkg.scripts[ten] || '')
        if (!lenh) return res({ ten, ma: 2, ra: `không có script \`${ten}\` trong package.json`, giay: 0 })
        // Gọi thẳng tsx thay vì `npm run` để bớt một tầng tiến trình cho mỗi mục.
        /* Truyền NGUYÊN chuỗi lệnh cho shell (không tách mảng args) — Node cảnh báo DEP0190 khi
         * vừa `shell: true` vừa truyền mảng, và trên Windows `npx` cần shell mới gọi được. */
        const p = spawn(lenh, { cwd: GOC, shell: true })
        let ra = ''
        p.stdout.on('data', d => { ra += d })
        p.stderr.on('data', d => { ra += d })
        p.on('close', ma => res({ ten, ma: ma ?? 1, ra, giay: (Date.now() - batDau) / 1000 }))
    })
}

/** Dòng tóm tắt của mỗi bộ soát (kiểu "27/27 ca đạt" hoặc "20 đạt, 0 hỏng"). */
const tomTat = (ra: string) => {
    const m = ra.match(/(\d+\/\d+ ca đạt|\d+ đạt, \d+ hỏng|✅[^\n]{0,60})/g)
    return m ? m[m.length - 1].trim() : ''
}

async function main() {
    const batDau = Date.now()
    const songSong = TUAN_TU ? 1 : Math.max(2, Math.min(6, os.cpus().length - 1))
    console.log(`▶ Chạy ${DANH_SACH.length} bộ soát${TUAN_TU ? ' (tuần tự)' : `, ${songSong} luồng`}…\n`)

    const ketQua: KetQua[] = []
    const hangDoi = [...DANH_SACH]
    await Promise.all(Array.from({ length: songSong }, async () => {
        for (let ten = hangDoi.shift(); ten; ten = hangDoi.shift()) {
            const kq = await chay(ten)
            ketQua.push(kq)
            const dau = kq.ma === 0 ? '✓' : '✗'
            console.log(`  ${dau} ${kq.ten.padEnd(20)} ${kq.giay.toFixed(1).padStart(5)}s  ${tomTat(kq.ra)}`)
        }
    }))

    const hong = ketQua.filter(k => k.ma !== 0)
    for (const k of hong) {
        console.log(`\n──── ${k.ten} (mã thoát ${k.ma}) ────`)
        console.log(k.ra.trimEnd())
    }
    const giay = ((Date.now() - batDau) / 1000).toFixed(1)
    console.log(`\n${ketQua.length - hong.length}/${ketQua.length} bộ soát đạt · ${giay}s`)
    process.exit(hong.length ? 1 : 0)
}

main()
