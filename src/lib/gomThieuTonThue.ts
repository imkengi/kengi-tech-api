/**
 * GOM LỖI "THIẾU TỒN KHO THUẾ" THÀNH DANH SÁCH MÃ HÀNG.
 *
 * Cron xuất hoá đơn báo `xuất 60, lỗi 59` rồi kèm ĐÚNG BA ví dụ (`errors.length
 * < 3`), và giới hạn đó áp cho cả thông báo chủ shop nhận. Chủ shop biết có 59
 * hoá đơn hỏng nhưng KHÔNG biết phải nhập chứng từ đầu vào cho mã nào — mà đó
 * mới là việc cần làm.
 *
 * Đo KENGISTORE tối 16/08/2026: 119 phiếu đủ điều kiện, xuất được 60, hỏng 59.
 * Mỗi lỗi có dạng:
 *
 *   Thiếu TỒN KHO THUẾ (SP000199 thiếu 1, SHD7346 thiếu 1) → nhập phiếu nhập…
 *
 * Cùng một mã thường lặp lại ở hàng chục phiếu, nên gộp lại thì 59 dòng rối rắm
 * co về vài mã cần mua chứng từ — việc làm được ngay.
 *
 * ⚠ Hàm này ĐỌC THÔNG BÁO LỖI DẠNG CHỮ. Nếu đổi câu chữ ở chỗ sinh lỗi thì phải
 * sửa cả đây; `soKhongDoc` được trả ra chính là để phát hiện chuyện đó — thấy nó
 * vọt lên bằng tổng số lỗi nghĩa là mẫu chữ đã đổi và bộ gộp đang mù.
 */

export interface ThieuTheoSku {
    sku: string
    /** Tổng số lượng còn thiếu, cộng qua mọi phiếu. */
    thieu: number
    /** Số phiếu bị chặn vì mã này. */
    soPhieu: number
}

export interface KetQuaGomThieu {
    theoSku: ThieuTheoSku[]
    /** Số lỗi KHÔNG phải "thiếu tồn kho thuế" — đừng gộp im lặng vào nhóm trên. */
    loiKhac: number
    /** Số lỗi đúng là thiếu tồn kho nhưng KHÔNG tách được mã (mẫu chữ đã đổi?). */
    soKhongDoc: number
}

/** Bỏ dấu để so khớp không phụ thuộc cách gõ. */
function boDau(s: string): string {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
}

export function gomThieuTonThue(loi: string[]): KetQuaGomThieu {
    const bang = new Map<string, ThieuTheoSku>()
    let loiKhac = 0
    let soKhongDoc = 0

    for (const raw of loi || []) {
        const s = String(raw || '')
        if (!/thieu ton kho thue/.test(boDau(s))) { loiKhac++; continue }

        /* HAI ĐỊNH DẠNG, cùng một thông tin — phải đọc được cả hai:
         *   cron   : `Thiếu TỒN KHO THUẾ (SHB212KT thiếu 1) → nhập chứng từ…`
         *   drawer : `THIẾU TỒN KHO THUẾ: SHB212KT thiếu 1 — nhập chứng từ…`
         * (`warnings` của GET /einvoice/queue/receipt/:txId dùng dạng hai chấm)
         *
         * Cắt phần đuôi hướng dẫn ở `→` / `—` trước khi tách, nếu không câu
         * hướng dẫn cũng bị quét tìm cặp mã/số. */
        const viTri = boDau(s).indexOf('thieu ton kho thue')
        let sau = s.slice(viTri).split(/[→—]/)[0]
        const trongNgoac = sau.match(/\(([^)]*)\)/)
        if (trongNgoac) sau = trongNgoac[1]
        else if (sau.includes(':')) sau = sau.slice(sau.indexOf(':') + 1)
        else { soKhongDoc++; continue }

        // "SP000199 thiếu 1, SHD7346 thiếu 2"
        const cap = [...sau.matchAll(/([^\s,]+)\s+thi[eế]u\s+([\d.]+)/gi)]
        if (!cap.length) { soKhongDoc++; continue }

        for (const c of cap) {
            const sku = c[1].trim()
            const n = Number(c[2]) || 0
            const cu = bang.get(sku)
            if (cu) { cu.thieu += n; cu.soPhieu++ }
            else bang.set(sku, { sku, thieu: n, soPhieu: 1 })
        }
    }

    // Mã chặn nhiều phiếu nhất lên đầu — đó là việc nên làm trước.
    const theoSku = [...bang.values()].sort((a, b) => b.soPhieu - a.soPhieu || b.thieu - a.thieu)
    return { theoSku, loiKhac, soKhongDoc }
}

/** Một dòng tóm tắt gọn để nhét vào log và thông báo. */
export function moTaThieuTonThue(kq: KetQuaGomThieu, toiDa = 8): string {
    if (!kq.theoSku.length && !kq.loiKhac && !kq.soKhongDoc) return ''
    const phan: string[] = []
    if (kq.theoSku.length) {
        /* Đếm phần còn lại từ CHÍNH SỐ MỤC đã cắt, đừng suy ngược từ chuỗi đã
         * ghép: bản đầu tôi viết `dau.split('), ').length`, đúng số nhưng phụ
         * thuộc dấu ngoặc trong câu chữ — đổi cách hiển thị là con số "…và N mã
         * nữa" sai âm thầm mà không ca kiểm nào chạm tới. */
        const hienThi = kq.theoSku.slice(0, toiDa)
        const dau = hienThi.map(x => `${x.sku} (thiếu ${x.thieu}, chặn ${x.soPhieu} phiếu)`).join(', ')
        const con = kq.theoSku.length - hienThi.length
        phan.push(`Thiếu chứng từ đầu vào ${kq.theoSku.length} mã: ${dau}${con > 0 ? ` …và ${con} mã nữa` : ''}`)
    }
    if (kq.soKhongDoc) phan.push(`${kq.soKhongDoc} lỗi thiếu tồn nhưng không đọc được mã`)
    if (kq.loiKhac) phan.push(`${kq.loiKhac} lỗi khác`)
    return phan.join(' | ')
}
