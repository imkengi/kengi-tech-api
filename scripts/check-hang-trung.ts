/**
 * Kiểm HẰNG SỐ BỊ CHÉP Ở NHIỀU FILE — npx tsx scripts/check-hang-trung.ts
 *
 * Cùng một danh sách trạng thái nằm ở hai ba file, khớp nhau bằng NIỀM TIN. Sửa
 * một bản sao mà quên bản kia thì hệ thống hỏng IM LẶNG: số vẫn ra, chỉ là sai.
 *
 * DÍNH THẬT 16/08/2026 ở đường nguy hiểm nhất — xoá vĩnh viễn. Danh sách "đơn
 * còn lên phiếu được" là hằng CỤC BỘ trong `orderSync.ts`, còn `donDuocXoa.ts`
 * tự giữ `['COMPLETED','completed']` để quyết đơn nào được xoá. Chỉ cần thêm
 * `DELIVERED` vào bộ lọc quét của cron mà quên bên kia là đơn ĐÃ GIAO chưa lên
 * phiếu bị xoá vô điều kiện. Đột biến xác nhận: 3/3 đơn `DELIVERED`/`delivered`/
 * `IN_TRANSIT` chưa có phiếu đều bị xoá. Bộ đó đã gộp về một nguồn sự thật.
 *
 * Khảo sát cùng ngày tìm thêm **10 bộ mảng chuỗi ≥3 phần tử xuất hiện ở nhiều
 * file**. Cả 10 hiện ĐANG KHỚP — đây là rủi ro trôi lệch tương lai, không phải
 * lỗi đang xảy ra. Gộp hết là refactor 7 file trên đường thuế/lãi/đồng bộ, cần
 * làm có chủ đích. Bộ kiểm này là bước rẻ hơn: KHOÁ chúng ở trạng thái khớp,
 * không đụng dòng mã chạy thật nào.
 *
 * CHỈ canh nhóm hỏng IM LẶNG. Danh sách role (`admin/manager/owner/…`) cố ý
 * KHÔNG đưa vào: lệch role thì người dùng mất quyền và báo ngay — hỏng ồn ào,
 * tự lộ, thêm vào chỉ tạo tiếng ồn.
 */

import * as fs from 'fs'
import * as path from 'path'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

export interface BoHang {
    ten: string
    /** Tập phần tử bắt buộc, không kể thứ tự. */
    thanhPhan: string[]
    /** File PHẢI chứa một mảng đúng tập đó. */
    file: string[]
    /** Hỏng kiểu gì nếu hai bản sao trôi lệch. */
    hauQua: string
}

/* Ba bộ hỏng IM LẶNG — số vẫn ra, chỉ sai. Xếp theo mức nguy hiểm. */
export const CAC_BO: BoHang[] = [
    {
        ten: 'trạng thái ĐÃ GIAO (hàng đợi HĐ ↔ báo cáo thuế)',
        thanhPhan: ['COMPLETED', 'DELIVERED', 'completed', 'delivered'],
        file: ['src/routes/einvoice.ts', 'src/routes/tax.ts'],
        hauQua: 'hàng đợi hoá đơn và báo cáo thuế đếm khác nhau ⇒ sổ với hoá đơn không đối chiếu được',
    },
    {
        ten: 'trạng thái HUỶ/TRẢ (tính lãi đơn sàn)',
        thanhPhan: ['CANCELLED', 'IN_CANCEL', 'TO_RETURN', 'cancelled', 'cancelling', 'returned'],
        file: ['src/lib/onlineOrderProfit.ts', 'src/routes/onlineOrders.ts'],
        hauQua: 'tính lãi trên đơn đã huỷ',
    },
    {
        ten: 'trạng thái HUỶ/CHƯA TRẢ TIỀN',
        thanhPhan: ['CANCELLED', 'UNPAID', 'cancelled'],
        file: ['src/cron/autoSync.ts', 'src/routes/admin.ts', 'src/routes/onlineOrders.ts'],
        hauQua: 'đơn coi là huỷ ở chỗ này, không huỷ ở chỗ kia',
    },
]

/** Mọi mảng chuỗi ≥2 phần tử trong file, trả về dưới dạng tập đã sắp xếp. */
export function cacMangChuoi(ma: string): string[][] {
    const ra: string[][] = []
    for (const m of ma.matchAll(/\[\s*((?:'[^']*'\s*,\s*)+'[^']*'\s*,?)\s*\]/g)) {
        ra.push([...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]))
    }
    return ra
}

/** File có chứa một mảng đúng tập `thanhPhan` không (không kể thứ tự/trùng lặp)? */
export function coBo(ma: string, thanhPhan: string[]): boolean {
    const can = [...new Set(thanhPhan)].sort().join('|')
    return cacMangChuoi(ma).some(a => [...new Set(a)].sort().join('|') === can)
}

function main() {
    console.log('\n▶ Hằng số bị chép ở nhiều file phải KHỚP NHAU\n')

    for (const bo of CAC_BO) {
        const thieu: string[] = []
        for (const f of bo.file) {
            const duong = path.join(process.cwd(), f)
            if (!fs.existsSync(duong)) { thieu.push(`${f} (không còn file)`); continue }
            if (!coBo(fs.readFileSync(duong, 'utf8'), bo.thanhPhan)) thieu.push(f)
        }
        /* NÓI RÕ PHẢI LÀM GÌ khi sập — có HAI tình huống rất khác nhau, và người
         * gặp thông báo cụt lủn dễ chọn đường nhanh nhất là xoá mục kiểm này đi.
         *
         *   - Lệch MỘT SỐ bản sao  → đúng là bug, sửa cho khớp lại.
         *   - Lệch HẾT bản sao     → đổi có chủ đích, cập nhật `thanhPhan` ở đây.
         *
         * Phân biệt được ngay bằng số file trong `lechO` so với tổng bản sao. */
        const lechHet = thieu.length === bo.file.length
        ok(`${bo.ten} — ${bo.file.length} bản sao còn khớp`, thieu.length === 0,
            thieu.length ? {
                lechO: thieu,
                hauQua: bo.hauQua,
                phaiLamGi: lechHet
                    ? 'MỌI bản sao đều khác tập ghi ở đây ⇒ nhiều khả năng bạn đã đổi có chủ đích: cập nhật `thanhPhan` của bộ này trong scripts/check-hang-trung.ts'
                    : 'Chỉ MỘT SỐ bản sao lệch ⇒ đây là bug trôi lệch thật: sửa file nêu trên cho khớp các bản còn lại',
            } : undefined)
    }

    // ── Bộ dò còn sống + đúng ranh giới ─────────────────────────────────────
    ok('đọc được mảng chuỗi thường',
        JSON.stringify(cacMangChuoi(`const x = ['a', 'b', 'c']`)) === JSON.stringify([['a', 'b', 'c']]))
    ok('không kể THỨ TỰ khi so tập', coBo(`const x = ['b','a','c']`, ['a', 'b', 'c']))
    ok('không kể phần tử TRÙNG', coBo(`const x = ['a','a','b']`, ['a', 'b']))

    /* PHẢI BẮT: thêm một phần tử vào một bản sao là lệch. Đây đúng hình dạng
     * của bẫy xoá đơn — thêm 'DELIVERED' vào một nơi, quên nơi kia. */
    ok('bắt được khi một bản sao THÊM phần tử',
        !coBo(`const x = ['a','b','c','DELIVERED']`, ['a', 'b', 'c']))
    ok('bắt được khi một bản sao THIẾU phần tử',
        !coBo(`const x = ['a','b']`, ['a', 'b', 'c']))

    // CHIỀU IM: mảng khác trong cùng file không được làm nhiễu
    ok('mảng khác trong cùng file không gây báo nhầm',
        coBo(`const y = ['x','y']\nconst x = ['a','b','c']`, ['a', 'b', 'c']))

    /* ── LỚP 2 (thêm 18/08/2026): TỰ PHÁT HIỆN cặp mới trong src/lib — CẢNH BÁO, không chặn.
     *
     * Lớp 1 ở trên chỉ canh những bộ đã LIỆT KÊ. Chiều 18/08 tôi tự chép lại
     * `TRANG_THAI_BAN` + 3 hàm ngày tháng sang file mới, đúng cái bẫy lớp 1 được
     * dựng để canh — mà lớp 1 im vì bộ đó chưa có trong danh sách. Lớp này quét mọi
     * mảng/Set chuỗi ≥2 phần tử trong src/lib, gom theo tập, báo cặp nào xuất hiện ở
     * ≥2 file. Chỉ src/lib (nơi đặt nguồn sự thật) để không ồn như quét toàn repo
     * (150 bộ / 10 trùng ở routes phần lớn là danh sách role — hỏng ồn ào, tự lộ). */
    {
        const goc = path.join(process.cwd(), 'src', 'lib')
        const theoTap = new Map<string, Set<string>>()
        for (const ten of fs.readdirSync(goc)) {
            if (!ten.endsWith('.ts')) continue
            const s = fs.readFileSync(path.join(goc, ten), 'utf8')
            // Set([...]) hoặc mảng thường, phần tử là chuỗi
            for (const m of s.matchAll(/(?:new Set\(\s*)?\[\s*((?:'[A-Za-z_][\w-]*'\s*,\s*){1,}'[A-Za-z_][\w-]*'\s*,?)\s*\]/g)) {
                const items = [...new Set([...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]))].sort()
                if (items.length < 2) continue
                const k = items.join('|')
                if (!theoTap.has(k)) theoTap.set(k, new Set())
                theoTap.get(k)!.add(ten)
            }
        }
        const trung = [...theoTap.entries()].filter(([k, files]) => files.size >= 2)
        console.log(`\n  Lớp 2 — quét src/lib: ${theoTap.size} tập chuỗi, ${trung.length} tập xuất hiện ở ≥2 file`)
        for (const [k, files] of trung) console.log(`    ⚠ [${k.split('|').slice(0, 5).join(', ')}${k.split('|').length > 5 ? ', …' : ''}] ở ${[...files].join(', ')} — nên gộp về một nguồn (nhập, đừng chép)`)
        // Không chặn: cảnh báo để người sửa thấy; chặn thì cần đưa vào CAC_BO ở lớp 1
        /* MỐC CHỐT: `['completed','partial']` ("phiếu đã bán") đang ở 11 file trong
         * src/lib — chép khắp nơi từ TRƯỚC 18/08, là khái niệm nền của cả hệ. Gộp
         * về một nguồn là refactor 11 file, làm có chủ đích. Ở đây chỉ canh KHÔNG
         * TĂNG THÊM: >11 file = ai đó vừa chép lại (đúng việc tôi làm chiều 18/08). */
        const soFileDaBan = theoTap.get('completed|partial')?.size ?? 0
        ok(`lớp 2: tập ['completed','partial'] KHÔNG lan thêm (mốc 11 file, nay ${soFileDaBan})`, soFileDaBan <= 11,
            { nay: soFileDaBan, o: [...(theoTap.get('completed|partial') ?? [])] })
        ok('lớp 2: bộ dò còn sống (quét được ≥20 tập trong src/lib)', theoTap.size >= 20, theoTap.size)
    }

    console.log(`\n  Canh ${CAC_BO.length} bộ hằng, ${CAC_BO.reduce((s, b) => s + b.file.length, 0)} bản sao.`)
    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
