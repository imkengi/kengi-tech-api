/**
 * GỢI Ý NỐI LISTING SÀN ↔ HÀNG KHO.
 *
 * Đo KENGISTORE 15/08/2026: 641 listing sàn, **0 cái** được nối sang hàng kho.
 * Hệ quả là ~1.188 đơn (≈740 triệu) đã bán mà không bao giờ lên phiếu, vì đơn
 * Shopee thường không có SKU nên `orderSync` chỉ còn đường dò listing đã nối.
 * Nối tay 641 cái là việc rất nản, nên phải có gợi ý.
 *
 * CHỈ GỢI Ý, KHÔNG TỰ NỐI. Nối sai là quy doanh thu và trừ kho vào nhầm mặt
 * hàng — sai kiểu đó âm thầm và khó lần hơn hẳn việc chưa nối. Người dùng nhìn
 * rồi bấm.
 *
 * Tên trên sàn là chuỗi tiếp thị dài ("[Sunhouse Chính Hãng] Nồi Cơm Điện
 * 1.8L…"), tên kho thì ngắn gọn — nên so khít nguyên chuỗi gần như luôn trượt.
 * Phải chuẩn hoá rồi so theo TỪ.
 */

/** Bỏ dấu tiếng Việt, hạ chữ thường, bỏ ngoặc tiếp thị và ký tự thừa. */
export function chuanHoaTen(s: string): string {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // bỏ dấu
        .replace(/đ/g, 'd')
        .replace(/\[[^\]]*\]/g, ' ')                        // bỏ [Hàng Chính Hãng]
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/* Từ tiếp thị xuất hiện ở gần như mọi listing — giữ lại thì listing nào cũng
 * "giống" listing nào, điểm khớp mất hết ý nghĩa phân biệt. */
const TU_RAC = new Set([
    'hang', 'chinh', 'hang chinh hang', 'chinh hang', 'gia', 're', 'moi', 'new',
    'combo', 'set', 'bo', 'cao', 'cap', 'loai', 'san', 'pham', 'chat', 'luong',
    'bao', 'hanh', 'thang', 'freeship', 'sale', 'gia re', 'tot', 'nhat',
])

export function tachTu(s: string): string[] {
    return chuanHoaTen(s).split(' ').filter(t => t.length >= 2 && !TU_RAC.has(t))
}

export interface GoiY {
    listingId: string
    tenListing: string
    skuListing: string | null
    productId: string
    tenHangKho: string
    skuKho: string | null
    diem: number
    mucTinCay: 'cao' | 'vua' | 'thap'
}

/**
 * Chấm điểm bằng tỉ lệ từ của TÊN KHO nằm trong tên listing.
 *
 * Cố ý lấy tên kho làm mẫu số, không phải tên listing: listing có rất nhiều từ
 * thừa, nếu chia theo nó thì mọi cặp đều điểm thấp. Câu hỏi đúng là "tên mặt
 * hàng kho có nằm trọn trong tên listing không".
 */
export function chamDiem(tuListing: Set<string>, tuKho: string[]): number {
    if (!tuKho.length) return 0
    let trung = 0
    for (const t of tuKho) if (tuListing.has(t)) trung++
    return trung / tuKho.length
}

export function goiYLienKet(
    listings: Array<{ id: string; name: string; sku: string | null }>,
    hangKho: Array<{ id: string; name: string; sku: string | null }>,
): GoiY[] {
    const khoDaTach = hangKho.map(p => ({ p, tu: tachTu(p.name) }))
    const ra: GoiY[] = []

    for (const l of listings) {
        const tuL = new Set(tachTu(l.name))
        if (!tuL.size) continue

        let tot: { p: any; diem: number } | null = null
        let nhi = 0
        for (const { p, tu } of khoDaTach) {
            const d = chamDiem(tuL, tu)
            if (!tot || d > tot.diem) { nhi = tot?.diem ?? 0; tot = { p, diem: d } }
            else if (d > nhi) nhi = d
        }
        if (!tot || tot.diem < 0.5) continue

        /* HAI MẶT HÀNG CÙNG ĐIỂM = KHÔNG PHÂN BIỆT ĐƯỢC.
         * Chảo 20cm và chảo 24cm chỉ khác đúng một con số; gợi ý bừa một cái là
         * doanh thu chạy vào nhầm mã. Điểm nhì sát điểm nhất thì hạ tin cậy
         * xuống thấp để người dùng buộc phải tự nhìn. */
        const cachBiet = tot.diem - nhi
        const mucTinCay: GoiY['mucTinCay'] =
            tot.diem >= 0.85 && cachBiet >= 0.15 ? 'cao'
                : tot.diem >= 0.65 && cachBiet >= 0.1 ? 'vua'
                    : 'thap'

        ra.push({
            listingId: l.id, tenListing: l.name, skuListing: l.sku,
            productId: tot.p.id, tenHangKho: tot.p.name, skuKho: tot.p.sku,
            diem: Math.round(tot.diem * 100) / 100,
            mucTinCay,
        })
    }
    return ra.sort((a, b) => b.diem - a.diem)
}
