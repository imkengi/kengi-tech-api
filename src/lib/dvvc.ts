/**
 * GOM NHÃN ĐƠN VỊ VẬN CHUYỂN — mỗi sàn gọi cùng một nhà một kiểu.
 *
 * ĐO 22/08/2026, KENGISTORE, quét ĐỦ 8.245/8.245 đơn (không cắt trang):
 *   5.669  "SPX Express"
 *     977  "GHN"
 *     598  "GHN - Hàng Cồng Kềnh"
 *     517  "Giao Hàng Nhanh"
 *     128  "VTP - Hàng Cồng Kềnh"
 *      23  "J&T Express"
 *      15  "Điểm nhận hàng"
 *       2  "VNP - Hàng Cồng Kềnh"
 *       1  "Tủ nhận hàng - Viettel Smartbox"
 *     315  (trống)
 *
 * GHN nằm dưới BA cái tên. Lọc theo chuỗi thô thì người dùng chọn "GHN" và
 * **hụt 1.115 đơn** so với bảng kê GHN gửi sang — đúng kiểu sai âm thầm mà
 * đối soát không bao giờ khớp và chẳng ai biết vì sao.
 *
 * LUẬT: chỉ gom khi **chắc chắn cùng một nhà**. Nhãn không nhận ra thì ĐỨNG
 * RIÊNG theo đúng chuỗi gốc — thà danh sách dài còn hơn gom lén hai nhà làm
 * một rồi báo cáo như thể đã gom đúng. Giao diện hiện luôn các nhãn thô trong
 * từng nhóm để việc gom là NHÌN THẤY ĐƯỢC, không phải tin suông.
 */

/** Bỏ dấu + thường hoá để so khớp; `đ` không nằm trong dải dấu nên phải thay tay. */
function khongDau(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim()
}

/** Bảng nhận diện — thứ tự CÓ nghĩa, khớp cái đầu tiên thì dừng. */
const BANG: { key: string; ten: string; dau: string[] }[] = [
    { key: 'ghn', ten: 'GHN (Giao Hàng Nhanh)', dau: ['ghn', 'giao hang nhanh'] },
    { key: 'spx', ten: 'SPX Express (Shopee)', dau: ['spx', 'shopee express'] },
    { key: 'vtp', ten: 'Viettel Post', dau: ['vtp', 'viettel'] },
    { key: 'vnpost', ten: 'VNPost (Bưu điện)', dau: ['vnp', 'vnpost', 'buu dien'] },
    { key: 'jt', ten: 'J&T Express', dau: ['j&t', 'jt express', 'j and t'] },
    { key: 'best', ten: 'BEST Express', dau: ['best express', 'best inc'] },
    { key: 'ninja', ten: 'Ninja Van', dau: ['ninja'] },
    { key: 'ahamove', ten: 'Ahamove', dau: ['ahamove'] },
    { key: 'grab', ten: 'Grab Express', dau: ['grab'] },
    { key: 'lex', ten: 'LEX (Lazada)', dau: ['lex', 'lazada express'] },
]

/** Khoá của nhóm chứa nhãn này. Không nhận ra ⇒ tự nó là một nhóm (`tho:<nhãn>`). */
export function khoaNhomDVVC(nhanTho: string | null | undefined): string {
    const s = String(nhanTho ?? '').trim()
    if (!s) return 'khong-co'
    const n = khongDau(s)
    for (const m of BANG) {
        if (m.dau.some(d => n.includes(d))) return m.key
    }
    return `tho:${s}`
}

/** Tên hiển thị của một khoá nhóm. */
export function tenNhomDVVC(key: string): string {
    if (key === 'khong-co') return 'Chưa có ĐVVC'
    if (key.startsWith('tho:')) return key.slice(4)
    return BANG.find(m => m.key === key)?.ten || key
}

export type NhomDVVC = {
    key: string
    ten: string
    tong: number
    /** Các nhãn THÔ nằm trong nhóm — để giao diện nói rõ đã gom những gì. */
    nhan: { ten: string; tong: number }[]
}

/**
 * Gom danh sách (nhãn thô, số đơn) thành các nhóm, sắp giảm dần theo số đơn.
 * Nhận cả nhãn rỗng/null → dồn vào nhóm `khong-co`.
 */
export function gomNhomDVVC(rows: { ten: string | null; tong: number }[]): NhomDVVC[] {
    const map = new Map<string, NhomDVVC>()
    for (const r of rows) {
        const key = khoaNhomDVVC(r.ten)
        let g = map.get(key)
        if (!g) {
            g = { key, ten: tenNhomDVVC(key), tong: 0, nhan: [] }
            map.set(key, g)
        }
        g.tong += r.tong
        if (key !== 'khong-co') g.nhan.push({ ten: String(r.ten ?? '').trim(), tong: r.tong })
    }
    for (const g of map.values()) g.nhan.sort((a, b) => b.tong - a.tong)
    return [...map.values()].sort((a, b) => b.tong - a.tong)
}
