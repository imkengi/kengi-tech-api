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

/**
 * Token trông như MÃ MÁY / QUY CÁCH: có cả chữ lẫn số, từ 4 ký tự
 * (`shd8611`, `ct16plus`, `20cm`). Đây thường là từ DUY NHẤT phân biệt hai mặt
 * hàng cùng dòng, nhưng phép chấm điểm theo tỉ lệ từ lại chỉ tính nó như một từ
 * bình thường.
 *
 * Đo KENGISTORE 16/08/2026: listing "Nồi Cơm Điện 1.8L Sunhouse **SHD8611**"
 * được gợi nối vào hàng kho "Nồi cơm điện 1.8L Sunhouse **SHD8638**" với 0,83
 * điểm — 5/6 từ khớp, lệch đúng cái mã. Listing đó đang chặn **1.026 đơn ≈ 710
 * triệu**; nối theo gợi ý là quy toàn bộ số đó vào nhầm đời máy.
 */
export function laMaMay(t: string): boolean {
    return t.length >= 4 && /[a-z]/.test(t) && /[0-9]/.test(t)
}

/** Số từ có nghĩa tối thiểu của TÊN KHO thì mới đủ làm bằng chứng. */
export const TU_KHO_TOI_THIEU = 2

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
    /* Loại thẳng mặt hàng có tên rút gọn còn quá ít từ có nghĩa.
     *
     * DÍNH THẬT 16/08/2026: "Phí bảo hành" sau khi bỏ từ tiếp thị chỉ còn ĐÚNG
     * MỘT từ `phi`, vì `bao` và `hanh` đều nằm trong TU_RAC. Mẫu số bằng 1 nên
     * bất kỳ listing nào có chữ "Miễn Phí Vận Chuyển" cũng khớp 1/1 = điểm
     * TUYỆT ĐỐI, và vì không mã nào khác lại gần nên nó còn được gắn "tin cậy
     * cao". Nối theo đó là ghi hàng nghìn đơn nồi cơm thành phí bảo hành. */
    const khoDaTach = hangKho
        .map(p => ({ p, tu: tachTu(p.name) }))
        .filter(x => x.tu.length >= TU_KHO_TOI_THIEU)
        .map(x => ({ ...x, ma: x.tu.filter(laMaMay) }))
    const ra: GoiY[] = []

    for (const l of listings) {
        const tuListing = tachTu(l.name)
        const tuL = new Set(tuListing)
        if (!tuL.size) continue
        const maL = new Set(tuListing.filter(laMaMay))

        let tot: { p: any; diem: number; tu: string[]; ma: string[] } | null = null
        let nhi = 0
        for (const { p, tu, ma } of khoDaTach) {
            /* MÃ MÁY KHÁC NHAU = KHÔNG PHẢI CÙNG MẶT HÀNG.
             * Chỉ xử khi CẢ HAI bên đều có mã: bên kho có mã mà listing không
             * ghi mã thì im lặng bỏ qua là gợi hụt, không phải gợi sai. */
            if (maL.size && ma.length && !ma.some(m => maL.has(m))) continue
            const d = chamDiem(tuL, tu)
            if (!tot || d > tot.diem) { nhi = tot?.diem ?? 0; tot = { p, diem: d, tu, ma } }
            else if (d > nhi) nhi = d
        }
        if (!tot || tot.diem < 0.5) continue

        /* HAI MẶT HÀNG CÙNG ĐIỂM = KHÔNG PHÂN BIỆT ĐƯỢC.
         * Chảo 20cm và chảo 24cm chỉ khác đúng một con số; gợi ý bừa một cái là
         * doanh thu chạy vào nhầm mã. Điểm nhì sát điểm nhất thì hạ tin cậy
         * xuống thấp để người dùng buộc phải tự nhìn. */
        const cachBiet = tot.diem - nhi

        /* "TIN CẬY CAO" PHẢI CÓ BẰNG CHỨNG CỨNG, vì chính cái nhãn đó là thứ
         * mời người ta bấm duyệt hàng loạt.
         *
         * Bằng chứng cứng = trùng MÃ MÁY, hoặc tên kho đủ dài để bản thân nó
         * đã đặc trưng. Thiếu cả hai thì điểm cao chỉ đang phản ánh việc tên
         * kho quá chung chung nên khớp trúng LỜI QUẢNG CÁO của listing.
         *
         * Đo KENGISTORE 16/08/2026, lấy mẫu 10 gợi ý "cao": 7 cái đúng thì cả
         * 7 đều trùng mã máy; 3 cái sai thì đều là tên kho hai từ chung chung —
         * "Quạt sàn Senko" (còn `quat`+`senko` vì `san` bị lọc) nuốt listing
         * quạt hộp Senko BD230; "Tay cầm" nuốt listing mỏ lết vì listing có
         * chữ "Tay Cầm Nhúng Nhựa"; "Linh Kiện" nuốt listing kìm cắt linh kiện.
         * Cả ba đều 1,0 điểm và đều được gắn "cao".
         *
         * Ngưỡng 4 từ đặt rộng hơn mức quan sát được (hỏng ở 2 từ) là cố ý:
         * gợi hụt thì người dùng tự tìm, gợi sai thì hỏng sổ. */
        const trungMaMay = tot.ma.length > 0 && tot.ma.some(m => maL.has(m))
        const duBangChung = trungMaMay || tot.tu.length >= 4

        const mucTinCay: GoiY['mucTinCay'] =
            duBangChung && tot.diem >= 0.85 && cachBiet >= 0.15 ? 'cao'
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
