/**
 * Kiểm chứng CHẶN TRÙNG SỐ HOÁ ĐƠN Ở PHIẾU NHẬP.
 *
 * Chạy:  npx tsx scripts/check-import-dup-invoice.ts
 *
 * Nhập trùng số hoá đơn đầu vào là khai trùng thuế GTGT được khấu trừ và trùng
 * chi phí được trừ — cơ quan thuế đối chiếu ra ngay vì bên bán chỉ phát hành
 * một tờ. Hậu quả là truy thu cộng phạt, không phải một lỗi nhập liệu vặt.
 *
 * Nhưng chặn quá tay còn tệ hơn: bắt người dùng sửa thứ không sai thì họ sẽ tìm
 * cách lách, hoặc bỏ luôn ô số hoá đơn — mất cả khả năng đối chiếu. Nên nửa bộ
 * test này là các ca KHÔNG ĐƯỢC CHẶN.
 */

import { timPhieuTrungSoHoaDon } from '../src/routes/importReceipts'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

function fake(ds: any[], loi = false) {
    return {
        importReceipt: {
            findMany: async ({ where }: any) => {
                if (loi) throw new Error('The table `ImportReceipt` does not exist')
                return ds.filter(r => {
                    if (where.supplierId && r.supplierId !== where.supplierId) return false
                    if (where.supplierName && r.supplierName !== where.supplierName) return false
                    if (where.status?.not && r.status === where.status.not) return false
                    if (where.vatInvoiceNo?.not === null && r.vatInvoiceNo == null) return false
                    if (where.id?.not && r.id === where.id.not) return false
                    return true
                })
            },
        },
    }
}

const P = (sua: any = {}) => ({
    id: 'r1', code: 'NH-20260801-001', supplierId: 'ncc1', supplierName: 'Công ty A',
    vatInvoiceNo: '0000123', status: 'completed', createdAt: new Date('2026-08-01'), ...sua,
})

async function main() {
    console.log('\n▶ Trùng thật — PHẢI chặn\n')

    const t1 = await timPhieuTrungSoHoaDon(fake([P()]), { vatInvoiceNo: '0000123', supplierId: 'ncc1' })
    ok('cùng nhà cung cấp, cùng số → chặn', !!t1, t1)
    ok('… trả về mã phiếu cũ để người dùng mở ra đối chiếu', t1?.code === 'NH-20260801-001', t1?.code)

    /* Chuẩn hoá: "HD 001" và "hd001" là cùng một tờ. Không bỏ khoảng trắng và
     * không bỏ phân biệt hoa thường thì chốt chặn này gần như vô dụng — người
     * gõ tay hiếm khi gõ giống hệt lần trước. */
    const t2 = await timPhieuTrungSoHoaDon(fake([P({ vatInvoiceNo: 'HD 001' })]), { vatInvoiceNo: 'hd001', supplierId: 'ncc1' })
    ok('khác khoảng trắng và hoa thường → vẫn chặn', !!t2, t2)

    const t3 = await timPhieuTrungSoHoaDon(fake([P({ supplierId: null })]), { vatInvoiceNo: '0000123', supplierName: 'Công ty A' })
    ok('nhà cung cấp chỉ có TÊN (chưa có mã) → vẫn chặn', !!t3, t3)

    console.log('\n▶ KHÔNG được chặn nhầm\n')

    const k1 = await timPhieuTrungSoHoaDon(fake([P()]), { vatInvoiceNo: '0000123', supplierId: 'ncc2' })
    ok('cùng số nhưng KHÁC nhà cung cấp → cho qua (mỗi bên một dải số)', k1 === null, k1)

    const k2 = await timPhieuTrungSoHoaDon(fake([P()]), { vatInvoiceNo: '0000124', supplierId: 'ncc1' })
    ok('cùng nhà cung cấp, khác số → cho qua', k2 === null, k2)

    const k3 = await timPhieuTrungSoHoaDon(fake([P({ status: 'cancelled' })]), { vatInvoiceNo: '0000123', supplierId: 'ncc1' })
    ok('phiếu cũ đã HUỶ → cho dùng lại số đó', k3 === null, k3)

    const k4 = await timPhieuTrungSoHoaDon(fake([P()]), { vatInvoiceNo: '', supplierId: 'ncc1' })
    ok('không nhập số hoá đơn → không chặn', k4 === null, k4)
    const k5 = await timPhieuTrungSoHoaDon(fake([P()]), { vatInvoiceNo: '   ', supplierId: 'ncc1' })
    ok('số hoá đơn chỉ có khoảng trắng → không chặn', k5 === null, k5)

    /* Sửa lại chính phiếu đang mở: số hoá đơn của nó trùng với chính nó là
     * chuyện đương nhiên, chặn ở đây là không cho sửa gì nữa. */
    const k6 = await timPhieuTrungSoHoaDon(fake([P()]), { vatInvoiceNo: '0000123', supplierId: 'ncc1', boQuaId: 'r1' })
    ok('sửa chính phiếu đó → không tự chặn mình', k6 === null, k6)

    /* Không biết nhà cung cấp thì không có căn cứ nào để nói là trùng. */
    const k7 = await timPhieuTrungSoHoaDon(fake([P()]), { vatInvoiceNo: '0000123' })
    ok('chưa chọn nhà cung cấp → không kết luận trùng', k7 === null, k7)

    console.log('\n▶ Đọc hỏng bảng — KHÔNG được chặn oan\n')

    /* Đọc hỏng mà chặn thì người dùng không nhập được phiếu nào, và lời báo lỗi
     * lại nói sai nguyên nhân. Thà cho qua còn hơn chặn oan. */
    const h1 = await timPhieuTrungSoHoaDon(fake([P()], true), { vatInvoiceNo: '0000123', supplierId: 'ncc1' })
    ok('không đọc được bảng phiếu nhập → cho qua', h1 === null, h1)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
