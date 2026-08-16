/**
 * Kiểm TÍNH LẠI TỔNG MUA CỦA KHÁCH — npx tsx scripts/check-tong-mua-khach.ts
 *
 * Ba trường `totalPurchases` / `totalOrders` / `lastPurchaseDate` là số tổng
 * hợp sẵn mà chỉ đường POS duy trì; đồng bộ KiotViet không đụng tới, nên cửa
 * hàng nhập bán từ KiotViet có khách mua hàng tỷ mà danh sách hiện "0 đơn · 0đ"
 * (đo HUTI 16/08/2026: 187 khách có định danh, 125 quay lại, mà tổng mua đều 0).
 *
 * Bộ này canh ba chỗ dễ sai và đều SAI IM LẶNG:
 *   - Bỏ sót đơn ghi nợ ('partial') → tổng mua hụt đúng phần bán chịu.
 *   - Lấy `createdAt` làm ngày mua → cửa hàng nhập lịch sử bị dồn hết về ngày
 *     chạy nhập, "mua gần nhất" sai cả tháng.
 *   - Đếm cả phiếu đã huỷ/trả → tổng mua phồng lên.
 */

import { gomTongMua } from '../src/lib/tinhLaiTongMuaKhach'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const p = (total: number, status: string, transactionDate?: string | null, createdAt?: string) =>
    ({ total, status, transactionDate: transactionDate ?? null, createdAt: createdAt ?? '2026-08-01T00:00:00Z' })

function main() {
    console.log('\n▶ Tính lại tổng mua của khách\n')

    // 1 — cộng đúng, đếm đúng
    const a = gomTongMua([p(100_000, 'completed'), p(250_000, 'completed')])
    ok('1. cộng đúng tổng và số đơn', a.totalPurchases === 350_000 && a.totalOrders === 2, a)

    /* 2 — ĐƠN GHI NỢ VẪN LÀ BÁN. Lọc mỗi 'completed' là tổng mua hụt đúng phần
     * bán chịu — cùng cái bẫy đã tố oan 677tr ở phép soát doanh thu. */
    const b = gomTongMua([p(100_000, 'completed'), p(900_000, 'partial')])
    ok('2. tính cả đơn ghi nợ (partial)', b.totalPurchases === 1_000_000 && b.totalOrders === 2, b)

    // 3 — phiếu huỷ/trả KHÔNG được tính
    const c = gomTongMua([
        p(100_000, 'completed'), p(500_000, 'voided'), p(300_000, 'returned'), p(50_000, 'draft'),
    ])
    ok('3. bỏ phiếu huỷ/trả/nháp', c.totalPurchases === 100_000 && c.totalOrders === 1, c)

    /* 4 — NGÀY MUA LÀ NGÀY BÁN, không phải ngày ghi dòng.
     * Cửa hàng nhập lịch sử từ phần mềm cũ có createdAt = lúc chạy nhập; lấy
     * nhầm là "mua gần nhất" lệch cả tháng và mọi phép chia nhóm theo độ tươi
     * (khách mới / khách ngủ) đều sai. */
    const d = gomTongMua([
        p(100_000, 'completed', '2026-03-15T00:00:00Z', '2026-06-20T00:00:00Z'),
        p(100_000, 'completed', '2026-05-02T00:00:00Z', '2026-06-20T00:00:00Z'),
    ])
    ok('4. lấy ngày bán muộn nhất, không lấy ngày nhập',
        d.lastPurchaseDate?.toISOString().slice(0, 10) === '2026-05-02', d.lastPurchaseDate)

    // 5 — thiếu transactionDate thì mới lùi về createdAt
    const e = gomTongMua([p(100_000, 'completed', null, '2026-07-09T00:00:00Z')])
    ok('5. thiếu ngày bán → lùi về ngày ghi dòng',
        e.lastPurchaseDate?.toISOString().slice(0, 10) === '2026-07-09', e.lastPurchaseDate)

    // 6 — CHIỀU IM: khách chưa mua gì thì ra 0, không bịa
    const f = gomTongMua([])
    ok('6. không phiếu nào → 0/0/null',
        f.totalPurchases === 0 && f.totalOrders === 0 && f.lastPurchaseDate === null, f)
    const g = gomTongMua([p(500_000, 'voided')])
    ok('6b. chỉ có phiếu huỷ → vẫn 0, không có ngày mua',
        g.totalPurchases === 0 && g.totalOrders === 0 && g.lastPurchaseDate === null, g)

    // 7 — dữ liệu méo không được làm nổ
    const h = gomTongMua([
        { total: null, status: 'completed' } as any,
        { total: 100_000, status: null } as any,
        { total: 50_000, status: 'completed', transactionDate: 'ngay-bay-ba' } as any,
    ])
    ok('7. total null → cộng 0 nhưng vẫn đếm đơn', h.totalOrders === 2 && h.totalPurchases === 50_000, h)
    ok('7b. ngày rác không lọt vào lastPurchaseDate', h.lastPurchaseDate === null, h.lastPurchaseDate)

    // 8 — làm tròn về đồng, đừng để đuôi số thực
    const i = gomTongMua([p(0.1, 'completed'), p(0.2, 'completed')])
    ok('8. làm tròn về đồng', Number.isInteger(i.totalPurchases), i.totalPurchases)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
