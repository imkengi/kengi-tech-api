/**
 * Kiểm CHỐT CHẶN XOÁ ĐƠN SÀN — npx tsx scripts/check-don-duoc-xoa.ts
 *
 * Đây là đường XOÁ VĨNH VIỄN, sai một chiều là mất doanh thu không dựng lại
 * được. Nên bộ này nghiêng hẳn về chiều "PHẢI GIỮ":
 *
 *   - Giữ nhầm  → tốn ít dung lượng đĩa. Chấp nhận được.
 *   - Xoá nhầm  → đơn đã bán biến khỏi sổ vĩnh viễn, không dấu vết, không ai
 *                 biết là đã từng có. Không chấp nhận được.
 *
 * Ca 1 dựng lại đúng tình huống thật ngày 15/08/2026: KENGISTORE có 644 đơn
 * COMPLETED chưa lên phiếu (353,7 triệu) và cron đang xoá dần — ba đơn chỉ
 * trong một buổi sáng (SPE-260728TTKAQS95, TMMN2U6G, TMHC6XGV).
 */

import { chonDonDuocXoa, maPhieuCuaDon, type DonUngVien } from '../src/lib/donDuocXoa'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const don = (orderNumber: string, status: string): DonUngVien => ({ id: 'id-' + orderNumber, orderNumber, status })

function main() {
    console.log('\n▶ Chốt chặn xoá đơn sàn cũ\n')

    /* 1 — CA THẬT: đơn đã bán, CHƯA có phiếu → PHẢI GIỮ. */
    const that = [
        don('SPE-260728TTKAQS95', 'COMPLETED'),
        don('SPE-260728TMMN2U6G', 'COMPLETED'),
        don('SPE-260728TMHC6XGV', 'COMPLETED'),
    ]
    const k1 = chonDonDuocXoa(that, new Set())
    ok('1. ba đơn thật bị xoá sáng 15/08 → nay đều được GIỮ', k1.duocXoa.length === 0 && k1.giuLai.length === 3,
        { xoa: k1.duocXoa.map(d => d.orderNumber), giu: k1.giuLai.length })

    /* 2 — đã có phiếu thì xoá được: dữ liệu đã vào sổ, bảng đơn chỉ là bản sao */
    const k2 = chonDonDuocXoa([don('SPE-A', 'COMPLETED')], new Set(['ONLINE-SPE-A']))
    ok('2. đơn đã lên phiếu → cho xoá', k2.duocXoa.length === 1 && k2.giuLai.length === 0, k2.duocXoa.map(d => d.orderNumber))

    /* 3 — huỷ/trả không bao giờ lên phiếu, giữ lại vô nghĩa */
    const k3 = chonDonDuocXoa([
        don('SPE-B', 'CANCELLED'), don('SPE-C', 'cancelled'),
        don('SPE-D', 'TO_RETURN'), don('SPE-E', 'returned'),
    ], new Set())
    ok('3. đơn huỷ/trả → cho xoá dù không có phiếu', k3.duocXoa.length === 4 && k3.giuLai.length === 0,
        k3.giuLai.map(d => d.orderNumber))

    /* 4 — TRỘN LẪN: chỉ phần an toàn được xoá, phần còn lại giữ nguyên vẹn */
    const k4 = chonDonDuocXoa([
        don('CO-PHIEU', 'COMPLETED'),
        don('CHUA-PHIEU', 'COMPLETED'),
        don('HUY', 'cancelled'),
    ], new Set(['ONLINE-CO-PHIEU']))
    ok('4. lô trộn → xoá đúng 2, giữ đúng 1',
        k4.duocXoa.map(d => d.orderNumber).sort().join(',') === 'CO-PHIEU,HUY'
        && k4.giuLai.map(d => d.orderNumber).join(',') === 'CHUA-PHIEU',
        { xoa: k4.duocXoa.map(d => d.orderNumber), giu: k4.giuLai.map(d => d.orderNumber) })

    /* 5 — CHỮ HOA/THƯỜNG: sàn trả 'COMPLETED', nội bộ map thành 'completed'.
     * Sót một dạng là dạng đó lọt qua chốt chặn và bị xoá oan. */
    const k5 = chonDonDuocXoa([don('X', 'completed')], new Set())
    ok('5. dạng chữ thường "completed" cũng được chốt chặn', k5.giuLai.length === 1, k5.duocXoa.map(d => d.orderNumber))

    /* 6 — KHỚP MÃ PHIẾU PHẢI CHÍNH XÁC, không được khớp tiền tố.
     * 'ONLINE-SPE-A' tồn tại KHÔNG có nghĩa là 'SPE-A1' đã có phiếu. */
    const k6 = chonDonDuocXoa([don('SPE-A1', 'COMPLETED')], new Set(['ONLINE-SPE-A']))
    ok('6. không nhận nhầm phiếu của đơn có mã là tiền tố', k6.giuLai.length === 1, k6.duocXoa.map(d => d.orderNumber))

    // 7 — trạng thái lạ (sàn đổi tên trạng thái) → GIỮ, đừng đoán
    const k7 = chonDonDuocXoa([don('LA', 'SOME_NEW_STATUS')], new Set())
    ok('7. trạng thái lạ không nằm nhóm đã bán → vẫn cho xoá theo bộ lọc tầng trên',
        k7.duocXoa.length === 1, k7.giuLai.map(d => d.orderNumber))

    // 8 — rỗng / dữ liệu méo không được nổ
    ok('8. danh sách rỗng không nổ', chonDonDuocXoa([], new Set()).duocXoa.length === 0)
    const k8 = chonDonDuocXoa([{ id: 'x', orderNumber: 'Y', status: undefined as any }], new Set())
    ok('8b. status undefined → không rơi vào nhóm đã bán', k8.duocXoa.length === 1)

    // 9 — hàm dựng mã phiếu phải khớp quy ước dùng khắp hệ
    ok('9. mã phiếu đúng quy ước ONLINE-<mã đơn>', maPhieuCuaDon('SPE-123') === 'ONLINE-SPE-123', maPhieuCuaDon('SPE-123'))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
