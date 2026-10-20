/**
 * Bộ soát CHIA KHỐI khi đăng video TikTok (lib/tiktokDangVideo.ts → chiaKhoiTikTok) — 20/10/2026.
 *   npx tsx scripts/check-tiktok-khoi.ts
 * Sự cố: video 10.759.282 byte (KENGISTORE, frame-SHD2065) khai chunk_size 10MB × 1 khối ⇒ TikTok trả
 * "inbox/init: invalid_params — The chunk size is invalid". Bản cũ lấy min(file, 10MB) nên MỌI file 10–20MB đều hỏng.
 * Luật TikTok: khối 5–64MB, total_chunk_count = FLOOR(video_size / chunk_size), khối cuối gánh phần dư (≤128MB),
 * file < 5MB gửi một khối; CHỈ MỘT khối thì chunk_size = video_size; tối đa 1.000 khối.
 */
import { chiaKhoiTikTok, KHOI_TIKTOK } from '../src/lib/tiktokDangVideo'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}
const MB = 1024 * 1024

/** Trả về danh sách vi phạm luật TikTok của một cách chia (rỗng = hợp lệ). */
function viPham(fileSize: number, k: { chunkSize: number; tongPhan: number }): string[] {
    const v: string[] = []
    const { chunkSize, tongPhan } = k
    if (!(tongPhan >= 1 && tongPhan <= 1000)) v.push(`số khối ${tongPhan} ngoài 1–1000`)
    if (tongPhan === 1) {
        if (chunkSize !== fileSize) v.push(`một khối mà chunk_size ${chunkSize} ≠ video_size ${fileSize}`)
        if (fileSize > 64 * MB) v.push('một khối lớn hơn 64MB')
    } else {
        if (chunkSize < 5 * MB || chunkSize > 64 * MB) v.push(`chunk_size ${chunkSize} ngoài 5–64MB`)
        if (tongPhan !== Math.floor(fileSize / chunkSize)) v.push('total_chunk_count ≠ FLOOR(video_size / chunk_size)')
        const cuoi = fileSize - (tongPhan - 1) * chunkSize
        if (cuoi < chunkSize || cuoi > 128 * MB) v.push(`khối cuối ${cuoi} sai`)
    }
    if (fileSize < 5 * MB && tongPhan !== 1) v.push('file < 5MB phải gửi một khối')
    return v
}

const CO = [1, 4_300_000, 5 * MB, 10 * MB - 1, 10 * MB, 10_759_282, 15 * MB, 20 * MB - 1, 20 * MB, 20 * MB + 1, 64 * MB, 105 * MB, 500 * MB, 4 * 1024 * MB]
for (const n of CO) {
    const k = chiaKhoiTikTok(n)
    const v = viPham(n, k)
    dung(`${(n / MB).toFixed(2)}MB ⇒ ${k.tongPhan} khối × ${(k.chunkSize / MB).toFixed(2)}MB hợp lệ`, v.length === 0, { k, v })
}

// Ca thật đo 20/10/2026
const that = chiaKhoiTikTok(10_759_282)
dung('ca thật 10.759.282 byte ⇒ một khối bằng cả file', that.tongPhan === 1 && that.chunkSize === 10_759_282, that)
// File lớn: khối 10MB, khối cuối gánh phần dư
const lon = chiaKhoiTikTok(105 * MB)
dung('105MB ⇒ 10 khối × 10MB, khối cuối 15MB', lon.tongPhan === 10 && lon.chunkSize === KHOI_TIKTOK && 105 * MB - 9 * KHOI_TIKTOK === 15 * MB, lon)
// Vòng tải: tổng byte các khối (tu..den như dangVideoTikTok) phủ đúng cả file, không chồng không hở
for (const n of [10_759_282, 20 * MB + 1, 105 * MB + 12345]) {
    const { chunkSize, tongPhan } = chiaKhoiTikTok(n)
    let tong = 0, lienMach = true, sau = 0
    for (let i = 0; i < tongPhan; i++) {
        const tu = i * chunkSize, den = i === tongPhan - 1 ? n - 1 : tu + chunkSize - 1
        if (tu !== sau) lienMach = false
        tong += den - tu + 1; sau = den + 1
    }
    dung(`vòng tải phủ đúng ${n} byte`, lienMach && tong === n, { tong, n })
}

// Ca đối chứng CHẮC SAI: phép chia CŨ phải bị bộ soát bắt — không bắt được thì bộ soát vô nghĩa
const cu = (n: number) => { const chunkSize = Math.min(n, KHOI_TIKTOK); return { chunkSize, tongPhan: Math.max(1, Math.floor(n / chunkSize)) } }
dung('đối chứng: phép chia cũ với file 10.759.282 byte bị bắt lỗi', viPham(10_759_282, cu(10_759_282)).length > 0, cu(10_759_282))

console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
process.exit(loi ? 1 : 0)
