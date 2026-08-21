/**
 * SOI FILE EXCEL MISA TRƯỚC KHI ĐỔ — `npx tsx scripts/check-misa-excel.ts <file.xlsx>`
 *
 * Chỉ ĐỌC. Không chạm cơ sở dữ liệu, không cần cửa hàng, không ghi gì.
 * Mục đích: nhìn thấy file chứa gì VÀ chỗ nào không đọc được, TRƯỚC khi bấm đổ.
 *
 * Mã thoát:  0 = đọc trọn vẹn · 1 = có dòng bỏ qua · 2 = KHÔNG đọc được file
 * Mã 2 tồn tại vì "đọc 0 dòng" phải khác "file không có dòng nào" — xem `misaExcel.ts`.
 */
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import { docSoBanHang, gomChungTu } from '../src/services/misaExcel'

const tien = (n: number) => n.toLocaleString('vi-VN') + 'đ'

async function main() {
    const duongDan = process.argv[2]
    if (!duongDan) {
        console.error('Thiếu tham số.  npx tsx scripts/check-misa-excel.ts <file.xlsx>')
        process.exit(2)
    }
    if (!fs.existsSync(duongDan)) {
        console.error(`Không thấy file: ${duongDan}`)
        process.exit(2)
    }

    const wb = XLSX.readFile(duongDan, { cellDates: false, raw: false })
    const tenSheet = wb.SheetNames[0]
    if (!tenSheet) { console.error('File không có sheet nào.'); process.exit(2) }
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[tenSheet]!, { header: 1, raw: false, defval: '' })

    console.log(`\n📄 ${duongDan.split(/[\\/]/).pop()}`)
    console.log(`   sheet: "${tenSheet}"  ·  ${rows.length} hàng thô\n`)

    // `--soi`: in CẤU TRÚC của báo cáo bất kỳ (không riêng sổ bán hàng). Dùng khi MISA
    // xuất một mẫu chưa hỗ trợ — nhìn tên cột là dựng được bảng ánh xạ ngay, khỏi đoán.
    if (process.argv.includes('--soi')) {
        console.log('🔍 CHẾ ĐỘ SOI CẤU TRÚC (không đọc dữ liệu)\n')
        for (let r = 0; r < Math.min(rows.length, 8); r++) {
            const o = (rows[r] || []).map(x => String(x ?? '').trim()).filter(Boolean)
            if (o.length) console.log(`   hàng ${r + 1}: ${o.slice(0, 6).join(' | ').slice(0, 100)}${o.length > 6 ? ` … (${o.length} ô)` : ''}`)
        }
        // Hàng tiêu đề = hàng có NHIỀU ô nhất trong 20 hàng đầu
        let best = { i: -1, n: 0 }
        for (let r = 0; r < Math.min(rows.length, 20); r++) {
            const n = (rows[r] || []).filter(x => String(x ?? '').trim()).length
            if (n > best.n) best = { i: r, n }
        }
        if (best.i >= 0) {
            console.log(`\n   Hàng tiêu đề (đoán): hàng ${best.i + 1} — ${best.n} cột\n`)
            ;(rows[best.i] || []).forEach((o, c) => {
                const ten = String(o ?? '').trim()
                if (!ten) return
                const mau = String(rows[best.i + 1]?.[c] ?? '').trim()
                const cot = c < 26 ? String.fromCharCode(65 + c) : `A${String.fromCharCode(39 + c)}`
                console.log(`      ${cot.padEnd(3)} ${ten.slice(0, 34).padEnd(36)} vd: ${mau.slice(0, 26)}`)
            })
        }
        console.log('')
        process.exit(0)
    }

    const kq = docSoBanHang(rows)

    if (kq.tieuDeThieu.length) {
        console.error(`❌ KHÔNG ĐỌC ĐƯỢC — thiếu cột bắt buộc: ${kq.tieuDeThieu.join(', ')}`)
        console.error(`   Đây là file khác mẫu "Sổ chi tiết bán hàng", hoặc MISA đã đổi tên cột.`)
        console.error(`   KHÔNG được coi là "file rỗng".`)
        process.exit(2)
    }

    const ct = gomChungTu(kq.dong)
    const tongDoanhSo = kq.dong.reduce((s, d) => s + d.doanhSo, 0)
    const tongThue = kq.dong.reduce((s, d) => s + d.thueGtgt, 0)
    const tongTra = kq.dong.reduce((s, d) => s + d.giaTriTra, 0)
    const coGiaVon = kq.dong.filter(d => d.giaVon !== null && d.giaVon !== 0).length
    const ngay = kq.dong.map(d => d.ngayChungTu || d.ngayHachToan).filter(Boolean) as Date[]
    const nho = ngay.length ? new Date(Math.min(...ngay.map(d => +d))) : null
    const lon = ngay.length ? new Date(Math.max(...ngay.map(d => +d))) : null
    const dmy = (d: Date | null) => d ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '?'

    console.log(`   Kỳ báo cáo   ${kq.kyBaoCao || '(không ghi)'}`)
    console.log(`   Khoảng ngày  ${dmy(nho)} → ${dmy(lon)}`)
    console.log(`   Đọc được     ${kq.docDuoc}/${kq.tongDong} dòng  ·  ${ct.length} chứng từ`)
    const votDG = ct.filter(c => c.nguonTenKhach === 'dienGiai').length
    const khongTen = ct.filter(c => c.nguonTenKhach === 'khong').length
    console.log(`   Khách        ${new Set(ct.map(c => c.maKhach || c.tenKhach)).size}`
        + (votDG ? `  (${votDG} chứng từ phải vớt tên từ diễn giải)` : ''))
    console.log(`   Mã hàng      ${new Set(kq.dong.map(d => d.maHang)).size}`)
    console.log(`   Doanh số     ${tien(tongDoanhSo)}`)
    console.log(`   Thuế GTGT    ${tien(tongThue)}`)
    if (tongTra) console.log(`   Trả lại      ${tien(tongTra)}`)

    // Giá vốn: nói thẳng là THIẾU, đừng để người đọc tự suy ra từ số 0
    if (coGiaVon === 0) {
        console.log(`\n⚠  GIÁ VỐN: MISA không xuất — cả ${kq.docDuoc} dòng đều trống/bằng 0.`)
        console.log(`   ⇒ Không thể tính lãi/lỗ từ file này. Nếu đổ vào mà coi giá vốn = 0`)
        console.log(`     thì mọi báo cáo sẽ cho LÃI ĐÚNG BẰNG DOANH THU (${tien(tongDoanhSo)}).`)
    } else if (coGiaVon < kq.docDuoc) {
        console.log(`\n⚠  GIÁ VỐN: chỉ ${coGiaVon}/${kq.docDuoc} dòng có — ${kq.docDuoc - coGiaVon} dòng thiếu.`)
    }

    if (votDG || khongTen) {
        console.log(`\n⚠  KHÁCH HÀNG: ${votDG + khongTen}/${ct.length} chứng từ bỏ trống cột "Tên khách hàng".`)
        if (votDG) console.log(`   ${votDG} chứng từ vớt được tên từ "Diễn giải chung" ("Bán hàng cho …").`)
        if (khongTen) console.log(`   ${khongTen} chứng từ KHÔNG xác định được khách — phải gán tay khi đổ.`)
        console.log(`   Đây là khách MISA chưa khai thành đối tượng, không phải khách lẻ.`)
    }

    if (kq.boQua.length) {
        console.log(`\n⚠  BỎ QUA ${kq.boQua.length} dòng:`)
        for (const b of kq.boQua.slice(0, 15)) console.log(`     dòng ${b.dong}: ${b.lyDo}`)
        if (kq.boQua.length > 15) console.log(`     … còn ${kq.boQua.length - 15} dòng nữa`)
    }

    // Vài chứng từ đầu, để mắt người soi được là gộp có đúng không
    console.log(`\n   Ví dụ chứng từ:`)
    for (const c of ct.slice(0, 3)) {
        console.log(`     ${c.soChungTu}  ${dmy(c.ngay)}  HĐ ${c.soHoaDon || '—'}  ${c.tenKhach}`)
        console.log(`        ${c.dong.length} dòng hàng · ${tien(c.tongDoanhSo)} + thuế ${tien(c.tongThue)}${c.thieuGiaVon ? ' · ⚠ thiếu giá vốn' : ''}`)
    }

    console.log('')
    process.exit(kq.boQua.length ? 1 : 0)
}

main().catch(e => { console.error('Lỗi:', e?.message || e); process.exit(2) })
