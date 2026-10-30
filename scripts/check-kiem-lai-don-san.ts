/**
 * Kiểm CHẾ ĐỘ KIỂM LẠI ĐƠN SÀN — npx tsx scripts/check-kiem-lai-don-san.ts
 *
 * Chủ shop 29/10/2026: "đơn online … khi chỉ đẩy đơn xong thì nó sẽ vẫn còn sai sót, hay thêm chế độ doublecheck" — "đẩy đơn" =
 * ghi nhận, nhận phí, xuất hoá đơn, cập nhật trả hàng, cho tới khi hoàn thành. Lõi lib/kiemLaiDonSan.ts.
 * Luật "thà im còn hơn báo sai": mỗi bước có cả ca PHẢI KÊU lẫn ca PHẢI IM (đơn huỷ, chờ xác nhận, mới giao, cửa hàng không dùng
 * HĐĐT, Lazada không có phí, bảng không đọc được ⇒ "không rõ" chứ không phải lỗi). Prisma giả.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import { soatMotDon, kiemLaiDonSan, phiDaQuyetToan, mstKhachKhai, dongChuaNoi, nenTangCuaMa, type DuLieuMotDon, type CauHinhKiem } from '../src/lib/kiemLaiDonSan'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const T = (s: string) => new Date(s)
const BAY_GIO = T('2026-10-29T12:00:00Z')
const CFG: CauHinhKiem = { dungHoaDonDienTu: true, tuXuat: true, soatSo: true }

const don = (x: any = {}) => ({ id: 'o1', orderNumber: 'SPE-2610290001AAAA', platform: 'shopee', channelId: 'c1', channelName: 'Kengi Store', status: 'COMPLETED', total: 500_000, createdAt: T('2026-10-20T03:00:00Z'), deliveredAt: T('2026-10-24T03:00:00Z'), customerName: 'K', platformFee: 50_000, platformFeeRate: 0, netRevenue: 450_000, khongKhopSku: false, ...x })
const phieu = (x: any = {}) => ({ id: 't1', receiptNumber: 'ONLINE-SPE-2610290001AAAA', status: 'completed', total: 500_000, notes: null, vatBuyerInfo: null, transactionDate: T('2026-10-20T03:00:00Z'), createdAt: T('2026-10-20T03:30:00Z'), ...x })
const hd = (x: any = {}) => ({ id: 'e1', status: 'SENT', invoiceType: 'SALE', invoiceNumber: '00000123', invoiceDate: '2026-10-25', totalAmount: 500_000, buyerTaxCode: null, replacedByInvoiceId: null, adjustedByInvoiceId: null, errorMessage: null, createdAt: T('2026-10-25T13:30:00Z'), ...x })
const du = (x: Partial<DuLieuMotDon> = {}): DuLieuMotDon => ({ don: don(), phieu: phieu(), tongDong: { tong: 500_000, soDong: 2 }, coSoSale: true, hoaDons: [hd()], traHangs: [], phiGiu: undefined, ...x })
const soat = (x: Partial<DuLieuMotDon> = {}, cfg: CauHinhKiem = CFG) => soatMotDon(du(x), cfg, BAY_GIO)

async function main() {
    console.log('\n▶ Kiểm lại đơn sàn — soát từng đơn qua cả vòng đời\n')

    /* 0 — hàm phụ */
    {
        ok('0a. phiDaQuyetToan: net ≠ 0 và không phải ước tính ⇒ true; net 0 ⇒ false', phiDaQuyetToan({ total: 500_000, platformFee: 50_000, platformFeeRate: 0, netRevenue: 450_000 }) && !phiDaQuyetToan({ total: 500_000, platformFee: 0, platformFeeRate: 0, netRevenue: 0 }))
        ok('0b. phí = round(total × rate) ±1 là ƯỚC TÍNH ⇒ chưa quyết toán; lệch nhiều hơn thì là số thật', !phiDaQuyetToan({ total: 500_000, platformFee: 25_000, platformFeeRate: 5, netRevenue: 475_000 }) && phiDaQuyetToan({ total: 500_000, platformFee: 31_250, platformFeeRate: 5, netRevenue: 468_750 }))
        ok('0c. mstKhachKhai bỏ khoảng trắng; JSON hỏng / thiếu MST ⇒ null', mstKhachKhai('{"taxCode":"0312 345 678"}') === '0312345678' && mstKhachKhai('{x') === null && mstKhachKhai('{"name":"A"}') === null && mstKhachKhai(null) === null)
        ok('0d. dongChuaNoi đọc "⚠ 2 dòng chưa nối được hàng kho"', dongChuaNoi('⚠ 2 dòng chưa nối được hàng kho: ABC') === 2 && dongChuaNoi('ghi chú thường') === 0 && dongChuaNoi(null) === 0)
        ok('0e. nền tảng từ tiền tố mã khi đơn đã dọn', nenTangCuaMa(null, 'TIK-123') === 'tiktok' && nenTangCuaMa(null, 'LZD-1') === 'lazada' && nenTangCuaMa(null, 'SPE-1') === 'shopee' && nenTangCuaMa({ platform: 'TikTok' } as any, 'SPE-1') === 'tiktok')
    }

    /* 1 — Đơn trọn vẹn: mọi ô xanh */
    {
        const r = soat()
        ok('1a. Đơn giao xong, phiếu khớp, vào sổ, phí thật, HĐ khớp, không trả ⇒ 4 ô ok/—, hoàn tất', r.phieu.tt === 'ok' && r.phi.tt === 'ok' && r.hoaDon.tt === 'ok' && r.traHang.tt === 'bo_qua' && r.hoanTat.tt === 'ok' && r.vanDe.length === 0, r)
        const n1 = soat({ hoaDons: [hd({ invoiceDate: T('2026-10-09T00:00:00Z') })] }), n2 = soat({ hoaDons: [hd({ invoiceDate: T('2026-10-09T17:30:00Z') })] })
        ok('1c. Ngày HĐ là Date (cột DateTime của Prisma) ⇒ "ngày 09/10/2026" theo giờ VN, không ra "Fri Oct 09 …"; 00:30 VN sang ngày mới', n1.hoaDon.ghiChu === 'HĐ 00000123 ngày 09/10/2026' && n2.hoaDon.ghiChu === 'HĐ 00000123 ngày 10/10/2026', [n1.hoaDon.ghiChu, n2.hoaDon.ghiChu])
        ok('1b. Số hiện: phiếu, số HĐ, phí, thực nhận', r.receiptNumber === 'ONLINE-SPE-2610290001AAAA' && r.soHoaDon === '00000123' && r.phiSan === 50_000 && r.thucNhan === 450_000 && !r.daDon && r.platform === 'shopee')
    }

    /* 2 — Ghi nhận */
    {
        const a = soat({ phieu: null, tongDong: null, hoaDons: [] })
        ok('2a. Đơn COMPLETED mà chưa lên phiếu ⇒ lỗi + "Chuyển lại đơn"; HĐ "—" (chưa có phiếu); hoàn tất lỗi', a.phieu.tt === 'loi' && a.phieu.hanhDong === 'Chuyển lại đơn' && a.hoaDon.tt === 'bo_qua' && a.hoanTat.tt === 'loi' && a.vanDe.length === 1, a)
        const b = soat({ don: don({ khongKhopSku: true }), phieu: null, tongDong: null, hoaDons: [] })
        ok('2b. Chưa lên phiếu vì mã sàn chưa nối ⇒ chỉ đường ánh xạ SKU', b.phieu.tt === 'loi' && /chưa nối hàng kho/.test(b.phieu.ghiChu) && /Ánh xạ SKU/.test(b.phieu.hanhDong || ''))
        const c = soat({ don: don({ status: 'READY_TO_SHIP', deliveredAt: null }), phieu: null, tongDong: null, hoaDons: [] })
        ok('2c. Chờ xác nhận bên sàn ⇒ CHỜ, không phải lỗi; HĐ chờ; hoàn tất chờ', c.phieu.tt === 'cho' && c.hoaDon.tt === 'bo_qua' && c.hoanTat.tt === 'cho' && c.vanDe.length === 0, c)
        const d = soat({ don: don({ status: 'CANCELLED', deliveredAt: null }), phieu: null, tongDong: null, hoaDons: [] })
        ok('2d. Đơn huỷ không phiếu ⇒ mọi ô "—", hoàn tất ok (không còn gì làm)', d.phieu.tt === 'bo_qua' && d.phi.tt === 'bo_qua' && d.hoaDon.tt === 'bo_qua' && d.hoanTat.tt === 'ok', d)
        const e = soat({ don: don({ status: 'CANCELLED', deliveredAt: null }), hoaDons: [] })
        ok('2e. Đơn huỷ mà phiếu vẫn completed (chưa đảo) ⇒ lỗi', e.phieu.tt === 'loi' && /chưa đảo/.test(e.phieu.ghiChu))
        const f = soat({ phieu: phieu({ notes: '⚠ 1 dòng chưa nối được hàng kho: SKU-X' }) })
        ok('2f. Phiếu có dòng chưa nối hàng kho (theo notes của orderSync) ⇒ lỗi', f.phieu.tt === 'loi' && /1 dòng hàng chưa nối/.test(f.phieu.ghiChu))
        const g = soat({ tongDong: { tong: 0, soDong: 0 } })
        ok('2g. Phiếu không có dòng hàng ⇒ lỗi', g.phieu.tt === 'loi' && /không có dòng hàng/.test(g.phieu.ghiChu))
        const h = soat({ phieu: phieu({ total: 480_000 }), hoaDons: [hd({ totalAmount: 480_000 })] })
        ok('2h. Tổng phiếu ≠ tổng đơn ⇒ lỗi (nói cả hai số)', h.phieu.tt === 'loi' && /480\.000đ/.test(h.phieu.ghiChu) && /500\.000đ/.test(h.phieu.ghiChu))
        const i = soat({ coSoSale: false })
        ok('2i. Chưa có bút toán SALE ⇒ lỗi "Ghi bù"', i.phieu.tt === 'loi' && /bút toán/.test(i.phieu.ghiChu) && /Ghi bù/.test(i.phieu.hanhDong || ''))
        ok('2j. Cửa hàng không soát sổ (HKD / tắt ghi sổ) ⇒ thiếu bút toán vẫn ok', soat({ coSoSale: false }, { ...CFG, soatSo: false }).phieu.tt === 'ok')
        ok('2k. coSoSale null (không đọc được) ⇒ không kết tội', soat({ coSoSale: null }).phieu.tt === 'ok')
        const l = soat({ phieu: phieu({ status: 'voided' }), hoaDons: [] })
        ok('2l. Phiếu đã đảo mà đơn COMPLETED không trả / huỷ ⇒ lỗi', l.phieu.tt === 'loi' && /đã đảo/.test(l.phieu.ghiChu))
        const m = soat({ don: don({ status: 'TO_RETURN' }), phieu: null, tongDong: null, hoaDons: [] })
        ok('2m. Đơn trả mà chưa từng có phiếu ⇒ "—" (không có gì để đảo)', m.phieu.tt === 'bo_qua')
    }

    /* 3 — Phí sàn */
    {
        ok('3a. Phí ước tính theo % (webhook cũ) ⇒ lỗi, nói rõ là ƯỚC TÍNH', (() => { const r = soat({ don: don({ platformFee: 25_000, platformFeeRate: 5, netRevenue: 475_000 }) }); return r.phi.tt === 'loi' && /ƯỚC TÍNH/.test(r.phi.ghiChu) && r.phiSan === null })())
        ok('3b. Đã giao mà net = 0 ⇒ lỗi "chưa lấy được phí thật"', (() => { const r = soat({ don: don({ platformFee: 0, netRevenue: 0 }) }); return r.phi.tt === 'loi' && /Chưa lấy được/.test(r.phi.ghiChu) })())
        ok('3c. Mới SHIPPED, net = 0 ⇒ CHỜ sàn quyết toán, không phải lỗi', soat({ don: don({ status: 'SHIPPED', deliveredAt: null, platformFee: 0, netRevenue: 0 }), hoaDons: [] }).phi.tt === 'cho')
        ok('3d. Quyết toán ÂM (hoàn tiền) vẫn là số thật ⇒ ok, có ghi "quyết toán âm"', (() => { const r = soat({ don: don({ platformFee: 20_000, netRevenue: -20_000 }) }); return r.phi.tt === 'ok' && /âm/.test(r.phi.ghiChu) && r.thucNhan === -20_000 })())
        ok('3e. Lazada ⇒ "—" (chưa có API phí)', soat({ don: don({ platform: 'lazada', orderNumber: 'LZD-1', platformFee: 0, netRevenue: 0 }), phieu: phieu({ receiptNumber: 'ONLINE-LZD-1' }) }).phi.tt === 'bo_qua')
        ok('3f. Đơn huỷ ⇒ phí "—"', soat({ don: don({ status: 'CANCELLED', platformFee: 0, netRevenue: 0 }), phieu: phieu({ status: 'voided' }), hoaDons: [] }).phi.tt === 'bo_qua')
    }

    /* 4 — Hoá đơn điện tử */
    {
        ok('4a. Cửa hàng không dùng HĐĐT ⇒ "—" dù chưa xuất', soat({ hoaDons: [] }, { ...CFG, dungHoaDonDienTu: false }).hoaDon.tt === 'bo_qua')
        ok('4b. Bảng HĐ không đọc được ⇒ KHÔNG RÕ, hoàn tất không rõ (không kết tội)', (() => { const r = soat({ hoaDons: null }); return r.hoaDon.tt === 'khong_ro' && r.hoanTat.tt === 'khong_ro' })())
        ok('4c. HĐ ghi 480k mà phiếu 500k ⇒ lỗi "Xuất HĐ thay thế"', (() => { const r = soat({ hoaDons: [hd({ totalAmount: 480_000 })] }); return r.hoaDon.tt === 'loi' && r.hoaDon.hanhDong === 'Xuất HĐ thay thế' })())
        ok('4d. Khách khai MST mà HĐ không có MST ⇒ lỗi; HĐ đúng MST (dù có khoảng trắng) ⇒ ok',
            soat({ phieu: phieu({ vatBuyerInfo: '{"taxCode":"0312345678"}' }) }).hoaDon.tt === 'loi'
            && soat({ phieu: phieu({ vatBuyerInfo: '{"taxCode":"0312345678"}' }), hoaDons: [hd({ buyerTaxCode: '0312 345 678' })] }).hoaDon.tt === 'ok')
        ok('4e. Chỉ có bản ERROR ⇒ lỗi kèm lý do VNPT', (() => { const r = soat({ hoaDons: [hd({ status: 'ERROR', invoiceNumber: null, errorMessage: 'Thiếu TỒN KHO THUẾ (SKU1 thiếu 2)' })] }); return r.hoaDon.tt === 'loi' && /TỒN KHO THUẾ/.test(r.hoaDon.ghiChu) })())
        ok('4f. Mới giao 10 giờ trước, chưa HĐ ⇒ CHỜ hàng đợi 20:30 (không kêu sớm)', soat({ don: don({ deliveredAt: T('2026-10-29T02:00:00Z') }), hoaDons: [] }).hoaDon.tt === 'cho')
        ok('4g. Giao 5 ngày trước, chưa HĐ, tự xuất bật ⇒ lỗi "Hàng đợi xuất HĐ"', (() => { const r = soat({ hoaDons: [] }); return r.hoaDon.tt === 'loi' && r.hoaDon.hanhDong === 'Hàng đợi xuất HĐ' })())
        ok('4h. Tự xuất TẮT và khách không khai MST ⇒ chờ xuất tay (im); khách có khai MST ⇒ vẫn lỗi',
            soat({ hoaDons: [] }, { ...CFG, tuXuat: false }).hoaDon.tt === 'cho'
            && soat({ hoaDons: [], phieu: phieu({ vatBuyerInfo: '{"taxCode":"0312345678"}' }) }, { ...CFG, tuXuat: false }).hoaDon.tt === 'loi')
        ok('4i. Chưa giao ⇒ chờ giao xong', soat({ don: don({ status: 'SHIPPED', deliveredAt: null }), hoaDons: [] }).hoaDon.tt === 'cho')
        const thayThe = soat({ hoaDons: [hd({ id: 'e1', status: 'REPLACED', invoiceNumber: '00000100', replacedByInvoiceId: 'e2', createdAt: T('2026-10-25T13:30:00Z') }), hd({ id: 'e2', invoiceType: 'REPLACEMENT', invoiceNumber: '00000130', createdAt: T('2026-10-27T13:30:00Z') })] })
        ok('4j. HĐ bị thay thế ⇒ lấy bản thay thế làm HĐ hiệu lực', thayThe.hoaDon.tt === 'ok' && thayThe.soHoaDon === '00000130')
        const dieuChinh = soat({ hoaDons: [hd({ adjustedByInvoiceId: 'e3', totalAmount: 500_000 }), hd({ id: 'e3', invoiceType: 'ADJUSTMENT', invoiceNumber: '00000140', totalAmount: -100_000 })] })
        ok('4k. Bản ĐIỀU CHỈNH không bị coi là HĐ hiệu lực; HĐ gốc đã điều chỉnh ⇒ ok, ghi chú', dieuChinh.hoaDon.tt === 'ok' && dieuChinh.soHoaDon === '00000123' && /điều chỉnh/.test(dieuChinh.hoaDon.ghiChu))
        ok('4l. Có trả hàng đang xử lý, chưa HĐ ⇒ chờ (hàng đợi không xuất)', soat({ hoaDons: [], traHangs: [{ code: 'RTN-SH-1', status: 'pending' }] }).hoaDon.tt === 'cho')
        const tuChoi = soat({ hoaDons: [], traHangs: [{ code: 'RTN-SH-2', status: 'rejected' }] })
        ok('4m. Trả hàng BỊ TỪ CHỐI không chặn hàng đợi (OPEN_RETURN_EXISTS bỏ rejected) ⇒ giao lâu mà chưa có HĐ là LỖI, không phải chờ', tuChoi.hoaDon.tt === 'loi' && tuChoi.traHang.tt === 'ok', [tuChoi.hoaDon, tuChoi.traHang])
    }

    /* 5 — Trả hàng */
    {
        ok('5a. Sàn báo TO_RETURN mà chưa có phiếu trả ⇒ lỗi "Đồng bộ trả hàng"', (() => { const r = soat({ don: don({ status: 'TO_RETURN' }) }); return r.traHang.tt === 'loi' && r.traHang.hanhDong === 'Đồng bộ trả hàng' })())
        ok('5b. Đã hoàn tiền mà phiếu chưa đảo ⇒ lỗi "Xử lý phiếu trả"', (() => { const r = soat({ traHangs: [{ code: 'RTN-SH-1', status: 'refunded' }], hoaDons: [] }); return r.traHang.tt === 'loi' && /chưa đảo/.test(r.traHang.ghiChu) && r.traHang.hanhDong === 'Xử lý phiếu trả' })())
        ok('5c. Hoàn tiền, phiếu đã đảo, HĐ chưa điều chỉnh ⇒ lỗi "Cần điều chỉnh"', (() => { const r = soat({ don: don({ status: 'returned' }), phieu: phieu({ status: 'voided' }), traHangs: [{ code: 'RTN-SH-1', status: 'refunded' }] }); return r.traHang.tt === 'loi' && /chưa điều chỉnh/.test(r.traHang.ghiChu) && r.traHang.hanhDong === 'Hoá đơn › Cần điều chỉnh' })())
        ok('5d. Hoàn tiền, phiếu đảo, HĐ đã điều chỉnh ⇒ ok; ghi nhận không kêu "phiếu đảo" vì có vụ trả', (() => { const r = soat({ don: don({ status: 'returned' }), phieu: phieu({ status: 'voided' }), hoaDons: [hd({ adjustedByInvoiceId: 'e3' })], traHangs: [{ code: 'RTN-SH-1', status: 'refunded' }] }); return r.traHang.tt === 'ok' && r.phieu.tt === 'ok' && r.hoanTat.tt === 'ok' })())
        ok('5e. Phiếu trả đang chờ duyệt ⇒ chờ', soat({ traHangs: [{ code: 'RTN-SH-1', status: 'pending' }], hoaDons: [] }).traHang.tt === 'cho')
        ok('5f. Trả hàng bị từ chối ⇒ ok, đơn vẫn hoàn tất', (() => { const r = soat({ traHangs: [{ code: 'RTN-SH-1', status: 'rejected' }] }); return r.traHang.tt === 'ok' && r.hoanTat.tt === 'ok' })())
        ok('5g. Vụ trả có nhiều phiếu: refunded thắng pending khi kết luận', soat({ don: don({ status: 'returned' }), phieu: phieu({ status: 'voided' }), hoaDons: [], traHangs: [{ code: 'A', status: 'pending' }, { code: 'B', status: 'refunded' }] }).traHang.ghiChu.includes('(B)'))
        ok('5h. IN_CANCEL (đang huỷ) ⇒ chờ, không kêu', (() => { const r = soat({ don: don({ status: 'IN_CANCEL', deliveredAt: null }), hoaDons: [] }); return r.traHang.tt === 'cho' && r.phieu.tt === 'ok' && r.hoanTat.tt === 'cho' })())
    }

    /* 6 — Đơn đã bị cron dọn (dựng từ phiếu) */
    {
        const a = soat({ don: null, phiGiu: { platformFee: 50_000, netRevenue: 450_000, nguon: 'chep-truoc-xoa' } })
        ok('6a. Đơn đã dọn: nền tảng từ tiền tố, phí từ PhiSanDon ⇒ ok, hoàn tất', a.daDon && a.platform === 'shopee' && a.orderNumber === 'SPE-2610290001AAAA' && a.phi.tt === 'ok' && /giữ lại/.test(a.phi.ghiChu) && a.hoanTat.tt === 'ok' && a.createdAt === '2026-10-20T03:00:00.000Z', a)
        ok('6b. Đã dọn, PhiSanDon không có dòng ⇒ lỗi "Lấy lại phí"', (() => { const r = soat({ don: null, phiGiu: null }); return r.phi.tt === 'loi' && r.phi.hanhDong === 'Lấy lại phí đơn đã dọn' })())
        ok('6c. Đã dọn, bảng PhiSanDon không đọc được ⇒ KHÔNG RÕ', soat({ don: null, phiGiu: undefined }).phi.tt === 'khong_ro')
        ok('6d. Đã dọn, "chua-lay-duoc" (net 0) ⇒ lỗi, không phải phí 0', (() => { const r = soat({ don: null, phiGiu: { platformFee: 0, netRevenue: 0, nguon: 'chua-lay-duoc' } }); return r.phi.tt === 'loi' && /chưa có số/.test(r.phi.ghiChu) })())
        ok('6e. Đã dọn mà chưa xuất HĐ ⇒ lỗi (đơn đã xong)', soat({ don: null, phiGiu: { platformFee: 1, netRevenue: 1, nguon: 'lay-lai' }, hoaDons: [] }).hoaDon.tt === 'loi')
        ok('6f. Đã dọn, phiếu đã đảo (đơn huỷ xưa) ⇒ phí / HĐ "—"', (() => { const r = soat({ don: null, phieu: phieu({ status: 'voided' }), hoaDons: [], traHangs: [{ code: 'RTN-SH-9', status: 'refunded' }] }); return r.phi.tt === 'bo_qua' && r.hoaDon.tt === 'bo_qua' && r.traHang.tt === 'ok' })())
    }

    /* 7 — Hàm nạp: prisma giả, hỏi theo lô, đơn đã dọn, bảng thiếu */
    {
        type O = { dons?: any[]; phieu?: any[]; dong?: Record<string, { tong: number; soDong: number }>; so?: string[]; hd?: any[]; tra?: any[]; phiGiu?: any[]; cfgHd?: any; cai?: any; khongCoHd?: boolean; khongCoPhiSan?: boolean }
        function giaSp(o: O) {
            const st = { goiPhieuIn: 0, goiPhieuStartsWith: 0, goiSo: 0, goiHd: 0, where: [] as any[] }
            /** Prisma thật CHỈ trả trường có trong `select` — prisma giả phải làm y vậy, kẻo đọc trường không select vẫn "chạy" ở đây
             *  mà ra undefined trên prod (30/10/2026: CHON_HD thiếu transactionId ⇒ đơn nào cũng "chưa xuất HĐ") */
            const chon = (rows: any[], select?: Record<string, boolean>) => (select ? rows.map(r => Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, r[k]]))) : rows)
            const sp: any = {
                onlineOrder: { findMany: async ({ where, take, select }: any) => { st.where.push(where); return chon((o.dons || []).filter(d => (!where.channelId || d.channelId === where.channelId) && d.createdAt >= where.createdAt.gte && d.createdAt <= where.createdAt.lte).slice(0, take), select) } },
                transaction: {
                    findMany: async ({ where, take, select }: any) => {
                        if (where.receiptNumber?.in) { st.goiPhieuIn++; return chon((o.phieu || []).filter(p => where.receiptNumber.in.includes(p.receiptNumber)), select) }
                        st.goiPhieuStartsWith++
                        return chon((o.phieu || []).filter(p => p.receiptNumber.startsWith('ONLINE-')).slice(0, take), select)
                    },
                },
                $queryRawUnsafe: async (sql: string, ids: string[]) => {
                    if (/FROM "TransactionItem"/.test(sql)) return ids.filter(id => o.dong?.[id]).map(id => ({ id, ...o.dong![id] }))
                    if (/FROM "PhiSanDon"/.test(sql)) { if (o.khongCoPhiSan) throw new Error('relation "PhiSanDon" does not exist'); return (o.phiGiu || []).filter(r => ids.includes(r.orderNumber)) }
                    return []
                },
                journalEntry: { findMany: async ({ where }: any) => { st.goiSo++; return (o.so || []).filter(r => where.reference.in.includes(r)).map(reference => ({ reference })) } },
                eInvoice: { findMany: async ({ where, select }: any) => { st.goiHd++; if (o.khongCoHd) throw new Error('relation "EInvoice" does not exist'); return chon((o.hd || []).filter(h => where.transactionId.in.includes(h.transactionId)), select) } },
                returnOrder: { findMany: async ({ where, select }: any) => chon((o.tra || []).filter(t => where.originalInvoice.in.includes(t.originalInvoice)), select) },
                eInvoiceConfig: { findFirst: async () => (o.cfgHd === undefined ? { active: true, extra: '{"autoIssueOnDelivery":true}' } : o.cfgHd) },
                storeSettings: { findFirst: async () => (o.cai === undefined ? { autoCreateJournalEntries: true, businessType: 'company' } : o.cai) },
            }
            return { sp, st }
        }
        const TU = T('2026-10-01T00:00:00+07:00'), DEN = T('2026-10-31T23:59:59.999+07:00')
        const D1 = don({ id: 'o1', orderNumber: 'SPE-A1', createdAt: T('2026-10-20T03:00:00Z') })
        const D2 = don({ id: 'o2', orderNumber: 'SPE-A2', createdAt: T('2026-10-21T03:00:00Z'), platformFee: 0, netRevenue: 0 })   // thiếu phí
        const P1 = phieu({ id: 't1', receiptNumber: 'ONLINE-SPE-A1' }), P2 = phieu({ id: 't2', receiptNumber: 'ONLINE-SPE-A2' })
        const P3 = phieu({ id: 't3', receiptNumber: 'ONLINE-SPE-DADON', transactionDate: T('2026-10-05T03:00:00Z') })   // đơn đã dọn
        const g = giaSp({
            dons: [D1, D2], phieu: [P1, P2, P3], dong: { t1: { tong: 500_000, soDong: 2 }, t2: { tong: 500_000, soDong: 1 }, t3: { tong: 500_000, soDong: 1 } },
            so: ['SALE-ONLINE-SPE-A1', 'SALE-ONLINE-SPE-A2', 'SALE-ONLINE-SPE-DADON'],
            hd: [{ ...hd({ id: 'e1' }), transactionId: 't1' }, { ...hd({ id: 'e3' }), transactionId: 't3' }],
            tra: [{ code: 'RTN-SH-X', status: 'rejected', originalInvoice: 'A2' }],   // mã sàn TRẦN (returnSync ghi khi không thấy đơn)
            phiGiu: [{ orderNumber: 'SPE-DADON', platformFee: 30_000, netRevenue: 470_000, nguon: 'chep-truoc-xoa' }],
        })
        const kq = await kiemLaiDonSan(g.sp, { tu: TU, den: DEN, bayGio: BAY_GIO })
        const theoMa = new Map(kq.ds.map(r => [r.orderNumber, r]))
        ok('7a. 2 đơn + 1 phiếu đã dọn ⇒ 3 dòng, xếp mới trước; đơn đã dọn đánh dấu daDon', kq.ds.length === 3 && kq.tongQuan.daDon === 1 && kq.ds[0]!.orderNumber === 'SPE-A2' && theoMa.get('SPE-DADON')?.daDon === true, kq.ds.map(r => r.orderNumber))
        ok('7b. Đơn A1 trọn vẹn; A2 thiếu phí ⇒ có vấn đề; đơn đã dọn lấy phí từ PhiSanDon', theoMa.get('SPE-A1')?.hoanTat.tt === 'ok' && theoMa.get('SPE-A2')?.phi.tt === 'loi' && theoMa.get('SPE-DADON')?.phi.tt === 'ok' && theoMa.get('SPE-DADON')?.thucNhan === 470_000, kq.ds)
        ok('7c. Phiếu trả ghi mã sàn TRẦN vẫn nối về đúng đơn (A2)', theoMa.get('SPE-A2')?.traHang.tt === 'ok' && /RTN-SH-X/.test(theoMa.get('SPE-A2')!.traHang.ghiChu))
        ok('7d. Tổng quan: soDon 3, hoanTat 2, coVanDe 1, theoBuoc.phi.loi 1, cauHinh đọc từ EInvoiceConfig', kq.tongQuan.soDon === 3 && kq.tongQuan.hoanTat === 2 && kq.tongQuan.coVanDe === 1 && kq.tongQuan.theoBuoc.phi.loi === 1 && kq.cauHinh.dungHoaDonDienTu && kq.cauHinh.tuXuat && kq.cauHinh.soatSo, kq.tongQuan)
        const chiLoi = await kiemLaiDonSan(g.sp, { tu: TU, den: DEN, chiVanDe: true, bayGio: BAY_GIO })
        ok('7e. chiVanDe ⇒ chỉ trả dòng còn việc, tổng quan vẫn đếm đủ', chiLoi.ds.length === 1 && chiLoi.ds[0]!.orderNumber === 'SPE-A2' && chiLoi.tongQuan.soDon === 3)
        const kenh = await kiemLaiDonSan(g.sp, { tu: TU, den: DEN, channelId: 'c1', bayGio: BAY_GIO })
        ok('7f. Lọc kênh ⇒ không gom phiếu đã dọn (phiếu không mang kênh), where có channelId', kenh.ds.length === 2 && kenh.tongQuan.daDon === 0 && g.st.where.some(w => w.channelId === 'c1'))

        // bảng thiếu ⇒ không rõ, không kết tội
        const thieu = giaSp({ dons: [D1], phieu: [P1, P3], dong: { t1: { tong: 500_000, soDong: 2 }, t3: { tong: 500_000, soDong: 1 } }, so: ['SALE-ONLINE-SPE-A1', 'SALE-ONLINE-SPE-DADON'], khongCoHd: true, khongCoPhiSan: true })
        const tk = await kiemLaiDonSan(thieu.sp, { tu: TU, den: DEN, bayGio: BAY_GIO })
        ok('7g. Bảng HĐ / PhiSanDon không đọc được ⇒ ô "không rõ", hoàn tất "không rõ" (không kết tội)', tk.ds.every(r => r.hoaDon.tt === 'khong_ro') && tk.ds.find(r => r.daDon)?.phi.tt === 'khong_ro' && tk.tongQuan.coVanDe === 0, tk.ds)

        // cửa hàng không HĐĐT + hộ kinh doanh ⇒ không hỏi bảng HĐ, không hỏi sổ
        const hkd = giaSp({ dons: [D1], phieu: [P1], dong: { t1: { tong: 500_000, soDong: 2 } }, cfgHd: null, cai: { autoCreateJournalEntries: true, businessType: 'household' } })
        const hk = await kiemLaiDonSan(hkd.sp, { tu: TU, den: DEN, bayGio: BAY_GIO })
        ok('7h. Không HĐĐT + hộ KD ⇒ HĐ "—", không hỏi bảng HĐ / sổ; đơn vẫn hoàn tất', hk.ds[0]!.hoaDon.tt === 'bo_qua' && hk.ds[0]!.hoanTat.tt === 'ok' && hkd.st.goiHd === 0 && hkd.st.goiSo === 0 && !hk.cauHinh.soatSo)

        // hỏi theo lô 500
        const nhieuDon = Array.from({ length: 1_200 }, (_, i) => don({ id: `o${i}`, orderNumber: `SPE-N${i}`, createdAt: T('2026-10-10T03:00:00Z') }))
        const nhieuPhieu = nhieuDon.map((d, i) => phieu({ id: `t${i}`, receiptNumber: `ONLINE-${d.orderNumber}` }))
        const lon = giaSp({ dons: nhieuDon, phieu: nhieuPhieu, dong: Object.fromEntries(nhieuPhieu.map(p => [p.id, { tong: 500_000, soDong: 1 }])), so: nhieuPhieu.map(p => `SALE-${p.receiptNumber}`), hd: nhieuPhieu.map(p => ({ ...hd({ id: `e${p.id}` }), transactionId: p.id })) })
        const kl = await kiemLaiDonSan(lon.sp, { tu: TU, den: DEN, bayGio: BAY_GIO })
        ok('7i. 1.200 đơn ⇒ phiếu hỏi 3 lô (500/500/200), đủ 1.200 dòng, không chạm trần', lon.st.goiPhieuIn === 3 && kl.ds.length === 1_200 && !kl.tongQuan.chamTran && kl.tongQuan.hoanTat === 1_200, { lo: lon.st.goiPhieuIn, so: kl.ds.length })
        const tran = await kiemLaiDonSan(lon.sp, { tu: TU, den: DEN, tran: 100, bayGio: BAY_GIO })
        ok('7j. Chạm trần ⇒ nói rõ chamTran', tran.tongQuan.chamTran && tran.ds.length === 100)
        ok('7k. HĐ nối về đúng phiếu qua transactionId (prisma giả chỉ trả trường có trong select) ⇒ A1 và đơn đã dọn mang số HĐ, ô HĐ ok',
            theoMa.get('SPE-A1')?.soHoaDon === '00000123' && theoMa.get('SPE-A1')?.hoaDon.tt === 'ok' && theoMa.get('SPE-DADON')?.hoaDon.tt === 'ok' && theoMa.get('SPE-A2')?.hoaDon.tt === 'loi',
            [theoMa.get('SPE-A1')?.hoaDon, theoMa.get('SPE-DADON')?.hoaDon, theoMa.get('SPE-A2')?.hoaDon])
    }

    console.log(`\n${hong ? '✗' : '✓'} ${dat} đạt, ${hong} hỏng\n`)
    process.exit(hong ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
