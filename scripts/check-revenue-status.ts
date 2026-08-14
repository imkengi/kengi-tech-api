/**
 * SOÁT BỘ LỌC TRẠNG THÁI KHI ĐỌC ĐƠN BÁN.
 *
 * Chạy:  npx tsx scripts/check-revenue-status.ts
 *
 * VÌ SAO CÓ FILE NÀY
 * Đơn bán chịu (ghi nợ) lưu với status 'partial'. Hàng đã giao, kho đã trừ,
 * doanh thu đã phát sinh — nó là đơn bán THẬT, chỉ chưa thu đủ tiền. Nhưng viết
 * `status: 'completed'` là cách tự nhiên nhất khi lọc "đơn đã bán", nên chỗ nào
 * cũng dễ lỡ tay bỏ mất nhóm 'partial'.
 *
 * Hậu quả không hề nhẹ và KHÔNG BAO GIỜ báo lỗi:
 *  - Ngày 14/08/2026 một cửa hàng bị bộ đối chiếu ba chiều tố "hoá đơn vượt sổ
 *    677 triệu" — vì hoá đơn của đơn ghi nợ có, còn đơn thì bị loại khỏi sổ.
 *  - Báo cáo lãi và câu trả lời của trợ lý AI thì hụt doanh thu một cách âm thầm:
 *    con số vẫn đẹp, vẫn hợp lý, chỉ là thiếu.
 *
 * TypeScript không bắt được (chuỗi nào cũng hợp lệ), test cũng không bắt được
 * nếu dữ liệu mẫu không có đơn ghi nợ. Chỉ có soát nguồn như thế này mới thấy.
 *
 * CÁCH BỎ QUA MỘT CHỖ CÓ CHỦ Ý
 * Đặt `// loc-trang-thai-co-y: <lý do>` ngay trên dòng `status:`. Có những chỗ
 * lọc hẹp là ĐÚNG — đối soát tiền vào tài khoản chỉ nên khớp đơn đã thu đủ, và
 * bảng "đơn ghi nợ" thì đương nhiên chỉ lấy 'partial'. Bắt buộc ghi lý do để
 * người sau biết đó là lựa chọn, không phải sơ suất.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const GOC = join(__dirname, '..')
const THU_MUC = ['src/lib', 'src/routes', 'src/cron', 'src/services']

/** Trạng thái nghĩa là "đơn bán thật, doanh thu đã phát sinh". */
const DOANH_THU = ['completed', 'partial']
const CHO_PHEP_BO_QUA = 'loc-trang-thai-co-y'

interface ViPham {
    file: string
    dong: number
    trich: string
    kieu: 'thieu-partial' | 'chi-partial'
}

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
                if (ten === 'node_modules' || ten === '__tests__' || ten === 'generated') continue
                duyet(p)
            } else if (ten.endsWith('.ts') && !ten.endsWith('.d.ts')) {
                ra.push(p)
            }
        }
    }
    duyet(join(GOC, thuMuc))
    return ra
}

/**
 * Tìm các lượt ĐỌC bảng đơn bán. Chỉ đọc mới quan tâm — lệnh ghi
 * (create/update) đặt status là chuyện khác hẳn.
 */
const DOC = /\b(?:prisma|p|tx|db)\.(transaction|transactionItem)\.(findMany|aggregate|groupBy|count|findFirst)\s*\(/g

/** Lấy khối where của một lượt gọi: từ vị trí mở ngoặc tới khi cân bằng ngoặc. */
function layKhoi(src: string, tuViTri: number): string {
    let sau = 0
    let i = tuViTri
    for (; i < src.length && i < tuViTri + 4000; i++) {
        const c = src[i]
        if (c === '(' || c === '{' || c === '[') sau++
        else if (c === ')' || c === '}' || c === ']') {
            sau--
            if (sau === 0) break
        }
    }
    return src.slice(tuViTri, i + 1)
}

/** Đọc danh sách trạng thái trong một khối where, nếu có khai báo. */
function docTrangThai(khoi: string): { co: boolean; ds: string[]; viTri: number } {
    // status: { in: ['a','b'] }
    const mIn = /status\s*:\s*\{\s*in\s*:\s*\[([^\]]*)\]/.exec(khoi)
    if (mIn) {
        const ds = Array.from(mIn[1].matchAll(/['"]([^'"]+)['"]/g)).map(m => m[1])
        return { co: true, ds, viTri: mIn.index }
    }
    // status: 'completed'
    const mDon = /status\s*:\s*['"]([^'"]+)['"]/.exec(khoi)
    if (mDon) return { co: true, ds: [mDon[1]], viTri: mDon.index }
    return { co: false, ds: [], viTri: -1 }
}

/**
 * Soát SQL THÔ. Bắt buộc phải có, và đây là phần dễ gây hại nhất:
 * `profit_report` lấy doanh thu bằng Prisma nhưng lấy GIÁ VỐN bằng SQL thô. Chỉ
 * nới một bên là doanh thu có phần bán chịu còn giá vốn thì không → LÃI BỊ THỔI
 * LÊN. Sai kiểu đó còn tệ hơn lỗi ban đầu vì nó làm người ta yên tâm nhầm.
 */
function soatSql(file: string, src: string, viPham: ViPham[]): void {
    const re = /\bstatus\s*(?:=\s*'([a-z_]+)'|IN\s*\(([^)]*)\))/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
        // Chỉ xét câu SQL đang đụng bảng đơn bán — nhìn quanh 600 ký tự.
        const quanh = src.slice(Math.max(0, m.index - 600), m.index + 200)
        if (!/"Transaction"|"TransactionItem"/.test(quanh)) continue
        // Bí danh phải là của bảng đơn bán, không phải phiếu nhập/hoá đơn.
        const truoc = src.slice(Math.max(0, m.index - 12), m.index)
        if (/\b(r|e|adj|a2|ro|i)\.\s*$/.test(truoc)) continue

        const ds = m[1] ? [m[1]] : Array.from(m[2].matchAll(/'([^']+)'/g)).map(x => x[1])
        const coDoanhThu = ds.some(s => DOANH_THU.includes(s))
        if (!coDoanhThu) continue
        if (DOANH_THU.every(s => ds.includes(s))) continue

        const truocDong = src.slice(Math.max(0, m.index - 600), m.index)
        if (truocDong.includes(CHO_PHEP_BO_QUA)) continue

        viPham.push({
            file: relative(GOC, file).replace(/\\/g, '/'),
            dong: src.slice(0, m.index).split('\n').length,
            trich: 'SQL: ' + src.slice(m.index, m.index + 60).replace(/\s+/g, ' ').trim(),
            kieu: ds.includes('completed') ? 'thieu-partial' : 'chi-partial',
        })
    }
}

function soat(): ViPham[] {
    const viPham: ViPham[] = []
    for (const tm of THU_MUC) {
        for (const file of moiFileTs(tm)) {
            const src = readFileSync(file, 'utf8')
            soatSql(file, src, viPham)
            DOC.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = DOC.exec(src)) !== null) {
                const batDau = src.indexOf('(', m.index + m[0].length - 1)
                let khoi = layKhoi(src, batDau)
                let tt = docTrangThai(khoi)

                /* ĐIỂM MÙ ĐÃ VÁ: có chỗ viết `const whereTx = {...}` rồi mới
                 * `findMany({ where: whereTx })`. Chỉ soi trong ngoặc của lượt
                 * gọi là bỏ lọt — mà bỏ lọt còn tệ hơn không có công cụ, vì nó
                 * tạo cảm giác đã soát sạch. Nên phải lần theo biến. */
                if (!tt.co) {
                    const mBien = /where\s*:\s*([A-Za-z_$][\w$]*)/.exec(khoi)
                    if (mBien) {
                        const khai = new RegExp(`(?:const|let|var)\\s+${mBien[1]}\\s*(?::[^=]+)?=\\s*\\{`).exec(src)
                        if (khai) {
                            const moNgoac = src.indexOf('{', khai.index)
                            const khoiBien = layKhoi(src, moNgoac)
                            const ttBien = docTrangThai(khoiBien)
                            if (ttBien.co) { khoi = khoiBien; tt = ttBien }
                        }
                    }
                }
                if (!tt.co) continue   // không lọc trạng thái → không phải lỗi lớp này

                const dsDoanhThu = tt.ds.filter(s => DOANH_THU.includes(s))
                if (dsDoanhThu.length === 0) continue   // lọc 'pending'/'cancelled'… việc khác

                const duNhom = DOANH_THU.every(s => tt.ds.includes(s))
                if (duNhom) continue

                // Có ghi chú cho phép bỏ qua ngay trước dòng status?
                /* Nhìn lùi 600 ký tự chứ không 200: ghi chú lý do thường dài vài dòng,
                 * cửa sổ hẹp làm công cụ bỏ qua chính lời giải thích vừa viết. */
                const truocStatus = khoi.slice(Math.max(0, tt.viTri - 600), tt.viTri)
                if (truocStatus.includes(CHO_PHEP_BO_QUA)) continue

                const dong = src.slice(0, batDau + tt.viTri).split('\n').length
                const trich = khoi.slice(Math.max(0, tt.viTri - 40), tt.viTri + 60)
                    .replace(/\s+/g, ' ').trim()
                viPham.push({
                    file: relative(GOC, file).replace(/\\/g, '/'),
                    dong,
                    trich,
                    kieu: tt.ds.includes('completed') ? 'thieu-partial' : 'chi-partial',
                })
            }
        }
    }
    return viPham
}

function main() {
    console.log('Soát bộ lọc trạng thái khi đọc đơn bán')
    const viPham = soat()
    console.log(`  quét ${THU_MUC.join(', ')}`)

    if (viPham.length === 0) {
        console.log('\n✅ Mọi lượt đọc đơn bán đều tính cả đơn ghi nợ.\n')
        return
    }

    console.log(`\n❌ ${viPham.length} chỗ đọc đơn bán BỎ SÓT đơn ghi nợ:\n`)
    for (const v of viPham) {
        console.log(`  ✗ ${v.file}:${v.dong}`)
        console.log(`      …${v.trich}…`)
        console.log(v.kieu === 'thieu-partial'
            ? `      thiếu 'partial' → doanh thu hụt phần bán chịu`
            : `      chỉ lấy 'partial' → thiếu đơn đã thu đủ`)
    }
    console.log(`
  Sửa: status: { in: ['completed', 'partial'] }
  Cố ý chỉ lấy đơn đã thu đủ thì ghi // ${CHO_PHEP_BO_QUA} ngay trên dòng status.

  Loại lỗi này KHÔNG bị TypeScript hay test bắt — số vẫn ra, vẫn hợp lý, chỉ là
  thiếu. Ngày 14/08/2026 nó từng làm một cửa hàng bị tố "hoá đơn vượt sổ 677 triệu".
`)
    process.exit(1)
}

main()
