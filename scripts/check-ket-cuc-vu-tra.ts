/**
 * Kiểm KẾT CỤC VỤ TRẢ HÀNG / HOÀN TIỀN — npx tsx scripts/check-ket-cuc-vu-tra.ts
 *
 * Chủ shop 22/10/2026: "chưa phân loại được các đơn bị sàn từ chối trả hàng hoàn tiền", rồi
 * "khó hiểu quá, sửa lại là khiếu nại thắng hay thua đi". Bộ lọc và thẻ thống kê ở tab Trả hàng
 * đọc chung lib/ketCucVuTra. Xếp nhầm nhóm là chủ shop đọc ngược túi tiền (khách tự huỷ thành
 * "khiếu nại thắng", khiếu nại thua thành "chấp nhận hoàn"…), nên mỗi chuỗi trạng thái ĐO ĐƯỢC
 * trên KENGISTORE 22/10 có một ca, kèm các ca biên (tên TikTok mới, phiếu nhập tay, ghi chú
 * rỗng, CRLF) và soát route đã nối đúng hàm.
 */
import fs from 'fs'
import path from 'path'
import { ketCucVuTra, demTheoKetCuc, trangTheoKetCuc, laKetCucVuTra, KET_CUC_VU_TRA } from '../src/lib/ketCucVuTra'
import { dongTranhChap } from '../src/lib/bangChungTikTok'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

/* Ghi chú đúng hình dạng returnSync / route khiếu nại ghi: dòng tạo "[Sàn] Status: X" + Return SN /
 * Tracking / Need return, mỗi lần đổi "[Sàn] X (giờ)", khiếu nại "[Khiếu nại] giờ — …". */
const GIO = '09:30:25 16/9/2026'
const tao = (san: 'Shopee' | 'TikTok', ma: string) => `[${san}] Status: ${ma}\nReturn SN: 123\nTracking: N/A\nNeed return: Có`
const doi = (san: 'Shopee' | 'TikTok', ma: string) => `[${san}] ${ma} (${GIO})`
const KN = '[Khiếu nại] 14:23 11/9/2026 — Hàng trả về bị hư hại — 2 ảnh — chờ Shopee phân xử'
const TC_TT = '[Từ chối TikTok] 19:35 06/10/2026 — Từ chối hoàn tiền — Thiếu bằng chứng — 1 ảnh'
const tc = (ma: string) => dongTranhChap(ma, new Date('2026-10-06T12:35:00Z'))
const sh = (status: string, ...dong: string[]) => ({ code: 'RTN-SH-2609100NK6HF2CC', status, notes: dong.join('\n') })
const tt = (status: string, ...dong: string[]) => ({ code: 'RTN-TT-4042133758982260303', status, notes: dong.join('\n') })

function la(ten: string, p: { code: string; status: string; notes?: string | null }, ketCuc: string, chua?: string) {
    const kq = ketCucVuTra(p)
    ok(ten, kq.ketCuc === ketCuc && (!chua || kq.chiTiet.includes(chua)), kq)
}

console.log('\n▶ Kết cục vụ trả hàng / hoàn tiền — khiếu nại thắng / thua\n')

/* 1 — Shopee: đúng các chuỗi đo được 22/10/2026 (số vụ ghi trong ngoặc) */
la('1a. CANCELLED ngay từ lần đầu thấy (40) → khách huỷ', sh('rejected', tao('Shopee', 'CANCELLED')), 'khach_huy')
la('1b. PROCESSING → CANCELLED (14) → khách huỷ', sh('rejected', tao('Shopee', 'PROCESSING'), doi('Shopee', 'CANCELLED')), 'khach_huy')
la('1c. REQUESTED → CANCELLED (10) → khách huỷ', sh('rejected', tao('Shopee', 'REQUESTED'), doi('Shopee', 'CANCELLED')), 'khach_huy')
la('1d. JUDGING → CANCELLED (9) → KHIẾU NẠI THẮNG, nói rõ huỷ khi Shopee đang xét',
    sh('rejected', tao('Shopee', 'JUDGING'), doi('Shopee', 'CANCELLED')), 'khieu_nai_thang', 'đang xét')
la('1e. PROCESSING → [Khiếu nại] → CLOSED (28) → KHIẾU NẠI THẮNG, Shopee đóng yêu cầu',
    sh('rejected', tao('Shopee', 'PROCESSING'), KN, doi('Shopee', 'CLOSED')), 'khieu_nai_thang', 'đóng yêu cầu')
la('1f. JUDGING → [Khiếu nại] → CLOSED (3) → khiếu nại thắng', sh('rejected', tao('Shopee', 'JUDGING'), KN, doi('Shopee', 'CLOSED')), 'khieu_nai_thang')
la('1g. PROCESSING → [Khiếu nại] → SELLER_DISPUTE → CLOSED (1) → khiếu nại thắng',
    sh('rejected', tao('Shopee', 'PROCESSING'), KN, doi('Shopee', 'SELLER_DISPUTE'), doi('Shopee', 'CLOSED')), 'khieu_nai_thang')
la('1h. CLOSED KHÔNG qua khiếu nại (4) → KHÔNG được gọi là thắng: khách huỷ / Shopee tự đóng',
    sh('rejected', tao('Shopee', 'CLOSED')), 'khach_huy', 'tự đóng')
la('1i. PROCESSING → CLOSED (4) → Shopee tự đóng', sh('rejected', tao('Shopee', 'PROCESSING'), doi('Shopee', 'CLOSED')), 'khach_huy', 'tự đóng')
la('1j. PROCESSING → [Khiếu nại] → ACCEPTED (10) → KHIẾU NẠI THUA',
    sh('approved', tao('Shopee', 'PROCESSING'), KN, doi('Shopee', 'ACCEPTED')), 'khieu_nai_thua', 'cho khách trả')
la('1k. JUDGING → ACCEPTED (9) → khiếu nại thua', sh('approved', tao('Shopee', 'JUDGING'), doi('Shopee', 'ACCEPTED')), 'khieu_nai_thua')
la('1l. JUDGING → PROCESSING → ACCEPTED (2) → khiếu nại thua',
    sh('approved', tao('Shopee', 'JUDGING'), doi('Shopee', 'PROCESSING'), doi('Shopee', 'ACCEPTED')), 'khieu_nai_thua')
la('1m. ACCEPTED không khiếu nại (393) → chấp nhận hoàn', sh('approved', tao('Shopee', 'ACCEPTED')), 'chap_nhan_hoan', 'đã chấp nhận')
la('1n. JUDGING → PROCESSING, phiếu pending (2) → ĐANG khiếu nại (chưa phán quyết)',
    sh('pending', tao('Shopee', 'JUDGING'), doi('Shopee', 'PROCESSING')), 'dang_khieu_nai')
la('1o. PROCESSING → [Khiếu nại] → SELLER_DISPUTE (1) → đang khiếu nại',
    sh('pending', tao('Shopee', 'PROCESSING'), KN, doi('Shopee', 'SELLER_DISPUTE')), 'dang_khieu_nai', 'chờ sàn xử')
la('1p. ACCEPTED rồi khiếu nại qua app, sàn chưa đổi trạng thái (vụ RRBOC) → đang khiếu nại, KHÔNG phải chấp nhận hoàn',
    sh('approved', tao('Shopee', 'ACCEPTED'), KN), 'dang_khieu_nai')
la('1q. PROCESSING, chưa ai quyết (11) → chờ xử lý', sh('pending', tao('Shopee', 'PROCESSING')), 'cho_xu_ly', 'đang xử lý')
la('1r. REQUESTED → chờ xử lý, khách vừa yêu cầu', sh('pending', tao('Shopee', 'REQUESTED')), 'cho_xu_ly', 'khách vừa yêu cầu')
la('1s. REFUND_PAID không khiếu nại → chấp nhận hoàn, đã hoàn tiền', sh('refunded', tao('Shopee', 'ACCEPTED'), doi('Shopee', 'REFUND_PAID')), 'chap_nhan_hoan', 'đã hoàn tiền')
la('1t. khiếu nại THUA (ACCEPTED) rồi khách mới huỷ → khách huỷ, KHÔNG phải thắng',
    sh('rejected', tao('Shopee', 'PROCESSING'), doi('Shopee', 'SELLER_DISPUTE'), doi('Shopee', 'ACCEPTED'), doi('Shopee', 'CANCELLED')), 'khach_huy')
la('1u. sàn đang JUDGING → đang khiếu nại, Shopee đang xét', sh('pending', tao('Shopee', 'PROCESSING'), doi('Shopee', 'JUDGING')), 'dang_khieu_nai', 'Shopee đang xét')
la('1v. khiếu nại xong sàn hoàn tiền (REFUND_PAID) → khiếu nại thua',
    sh('refunded', tao('Shopee', 'PROCESSING'), KN, doi('Shopee', 'REFUND_PAID')), 'khieu_nai_thua', 'được hoàn tiền')

/* 2 — TikTok: "Từ chối" là cách shop phản đối vụ trả ⇒ tính là khiếu nại */
la('2a. AWAITING_BUYER_SHIP → CANCEL (17) → khách huỷ: khách không gửi hàng về',
    tt('rejected', tao('TikTok', 'AWAITING_BUYER_SHIP'), doi('TikTok', 'RETURN_OR_REFUND_REQUEST_CANCEL')), 'khach_huy', 'không gửi hàng')
la('2b. PENDING → CANCEL (4) → khách huỷ', tt('rejected', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'RETURN_OR_REFUND_REQUEST_CANCEL')), 'khach_huy', 'khách huỷ')
la('2c. CANCEL từ lần đầu thấy (4) → khách huỷ', tt('rejected', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_CANCEL')), 'khach_huy')
la('2d. PENDING → REFUND_OR_RETURN_REQUEST_REJECT (4) → KHIẾU NẠI THẮNG: shop từ chối, khách không kiện lên sàn',
    tt('rejected', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT')), 'khieu_nai_thang', 'không kiện')
la('2e. AWAITING_BUYER_SHIP → REJECT_RECEIVE_PACKAGE (1) → khiếu nại thắng: từ chối nhận hàng trả',
    tt('rejected', tao('TikTok', 'AWAITING_BUYER_SHIP'), doi('TikTok', 'REJECT_RECEIVE_PACKAGE')), 'khieu_nai_thang', 'nhận hàng trả')
la('2f. REJECT → COMPLETE → tranh chấp SUPPORT_BUYER (1, phiếu refunded) → KHIẾU NẠI THUA, TikTok xử cho khách',
    tt('refunded', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT'), doi('TikTok', 'RETURN_OR_REFUND_REQUEST_COMPLETE'), tc('SUPPORT_BUYER')),
    'khieu_nai_thua', 'xử cho khách')
la('2g. REJECT → IN_PROGRESS → SUPPORT_BUYER → SUCCESS (1) → khiếu nại thua',
    tt('refunded', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT'), tc('IN_PROGRESS'), tc('SUPPORT_BUYER'), doi('TikTok', 'RETURN_OR_REFUND_REQUEST_SUCCESS')),
    'khieu_nai_thua')
la('2h. shop từ chối, khách kiện lên sàn (IN_PROGRESS) → đang khiếu nại',
    tt('rejected', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT'), tc('IN_PROGRESS')), 'dang_khieu_nai', 'kiện lên TikTok')
la('2i. sàn xử cho shop (SUPPORT_SELLER) → khiếu nại thắng',
    tt('rejected', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT'), tc('IN_PROGRESS'), tc('SUPPORT_SELLER')), 'khieu_nai_thang', 'xử cho shop')
la('2j. SUPPORT_SELLER rồi vụ chuyển CANCEL (cùng lượt sync: dòng tranh chấp ghi TRƯỚC) → vẫn thắng',
    tt('rejected', tao('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT'), tc('SUPPORT_SELLER'), doi('TikTok', 'RETURN_OR_REFUND_REQUEST_CANCEL')), 'khieu_nai_thang')
la('2k. đang phân xử (IN_PROGRESS) thì vụ CANCEL → thắng, huỷ khi TikTok đang xét',
    tt('rejected', tao('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT'), tc('IN_PROGRESS'), doi('TikTok', 'RETURN_OR_REFUND_REQUEST_CANCEL')), 'khieu_nai_thang', 'TikTok đang xét')
la('2l. từ chối QUA APP rồi TikTok báo REJECT → khiếu nại thắng',
    tt('rejected', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), TC_TT, doi('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT')), 'khieu_nai_thang')
la('2m. tên MỚI REQUEST_REJECTED (sync quy đổi thành pending) → khiếu nại thắng, KHÔNG phải chờ xử lý',
    tt('pending', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'REQUEST_REJECTED')), 'khieu_nai_thang')
la('2n. tên MỚI RECEIVE_REJECTED → khiếu nại thắng, từ chối nhận hàng trả', tt('pending', tao('TikTok', 'BUYER_SHIPPED_ITEM'), doi('TikTok', 'RECEIVE_REJECTED')), 'khieu_nai_thang', 'nhận hàng trả')
la('2o. BUYER_SHIPPED_ITEM (approved) → chờ xử lý: shop phải nhận hàng hoặc kháng nghị',
    tt('approved', tao('TikTok', 'AWAITING_BUYER_SHIP'), doi('TikTok', 'BUYER_SHIPPED_ITEM')), 'cho_xu_ly', 'kháng nghị')
la('2p. AWAITING_BUYER_SHIP (approved) → chấp nhận hoàn, chờ khách gửi hàng', tt('approved', tao('TikTok', 'AWAITING_BUYER_SHIP')), 'chap_nhan_hoan', 'chờ khách gửi hàng')
la('2q. COMPLETE (93) → chấp nhận hoàn, đã hoàn tiền', tt('refunded', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_COMPLETE')), 'chap_nhan_hoan', 'đã hoàn tiền')
la('2r. PENDING (1) → chờ xử lý', tt('pending', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING')), 'cho_xu_ly', 'khách vừa yêu cầu')
la('2s. từ chối qua app, TikTok CHƯA báo lại → đang khiếu nại (chờ sàn)', tt('pending', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), TC_TT), 'dang_khieu_nai')
la('2t. shop từ chối mà khách VẪN được hoàn (REJECT → COMPLETE, không có dòng tranh chấp) → khiếu nại thua',
    tt('refunded', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT'), doi('TikTok', 'RETURN_OR_REFUND_REQUEST_COMPLETE')), 'khieu_nai_thua')
la('2u. shop từ chối rồi vụ quay về chờ khách gửi hàng (bị lật) → khiếu nại thua',
    tt('approved', tao('TikTok', 'RETURN_OR_REFUND_REQUEST_PENDING'), doi('TikTok', 'REFUND_OR_RETURN_REQUEST_REJECT'), doi('TikTok', 'AWAITING_BUYER_SHIP')), 'khieu_nai_thua')

/* 3 — phiếu nhập tay / không có mã sàn: theo trạng thái app */
la('3a. RTN-SH-M pending không ghi chú → chờ xử lý (chờ duyệt)', { code: 'RTN-SH-M260703PVMJ7K94', status: 'pending', notes: null }, 'cho_xu_ly', 'chờ duyệt')
la('3b. RTN-ON refunded → chấp nhận hoàn', { code: 'RTN-ON-0001', status: 'refunded', notes: 'Nhập tay' }, 'chap_nhan_hoan')
la('3c. RTN-ON rejected → từ chối đứng vững = khiếu nại thắng (trong Kengi)', { code: 'RTN-ON-0002', status: 'rejected', notes: '' }, 'khieu_nai_thang', 'trong Kengi')
la('3d. RTN-TT-M approved → chấp nhận hoàn', { code: 'RTN-TT-M4042', status: 'approved' }, 'chap_nhan_hoan')
la('3e. exchanged → chấp nhận hoàn (đổi hàng)', { code: 'RTN-ON-0003', status: 'exchanged' }, 'chap_nhan_hoan', 'đổi hàng')

/* 4 — đọc ghi chú chắc tay */
la('4a. ghi chú CRLF đọc y như LF', sh('rejected', [tao('Shopee', 'JUDGING'), doi('Shopee', 'CANCELLED')].join('\r\n')), 'khieu_nai_thang')
la('4b. mã sàn nằm GIỮA dòng (lời khách / ghi chú) không tính là trạng thái',
    sh('pending', tao('Shopee', 'PROCESSING'), 'Khách ghi: "[Shopee] CLOSED rồi mà"'), 'cho_xu_ly')
la('4c. dòng thụt lề vẫn đọc', sh('rejected', tao('Shopee', 'PROCESSING'), KN, '   ' + doi('Shopee', 'CLOSED')), 'khieu_nai_thang')
ok('4d. trạng thái lạ + không ghi chú → không nổ, ra chờ xử lý', ketCucVuTra({ code: 'RTN-SH-x', status: 'processing', notes: undefined }).ketCuc === 'cho_xu_ly')
ok('4e. laKetCucVuTra chỉ nhận đúng 6 mã — mã của bản đầu (san_tu_choi…) bị bỏ qua, không lọc bừa',
    KET_CUC_VU_TRA.every(k => laKetCucVuTra(k)) && KET_CUC_VU_TRA.length === 6
    && !laKetCucVuTra('san_tu_choi') && !laKetCucVuTra('khach_duoc_hoan') && !laKetCucVuTra('rejected') && !laKetCucVuTra(['khieu_nai_thang']) && !laKetCucVuTra(undefined))

/* 5 — đếm + cắt trang */
{
    const ds = [
        { ...sh('rejected', tao('Shopee', 'CLOSED')), id: 'a', totalRefund: 100_000 },
        { ...sh('rejected', tao('Shopee', 'CANCELLED')), id: 'b', totalRefund: 50_000 },
        { ...sh('rejected', tao('Shopee', 'JUDGING'), doi('Shopee', 'CANCELLED')), id: 'c', totalRefund: 30_000 },
        { ...sh('approved', tao('Shopee', 'ACCEPTED')), id: 'd', totalRefund: null },
        { ...sh('rejected', tao('Shopee', 'PROCESSING'), KN, doi('Shopee', 'CLOSED')), id: 'e', totalRefund: 20_000 },
    ]
    const dem = demTheoKetCuc(ds)
    ok('5a. đếm đủ 6 nhóm kể cả nhóm 0 vụ', KET_CUC_VU_TRA.every(k => dem[k] && typeof dem[k].soVu === 'number') && dem.dang_khieu_nai.soVu === 0, dem)
    ok('5b. khiếu nại thắng = 2 vụ (huỷ khi đang xét, đóng sau khiếu nại) · 50.000đ; khách huỷ = 2 (tự đóng, huỷ) · 150.000đ',
        dem.khieu_nai_thang.soVu === 2 && dem.khieu_nai_thang.soTien === 50_000 && dem.khach_huy.soVu === 2 && dem.khach_huy.soTien === 150_000, dem)
    ok('5c. totalRefund null tính 0, tổng số vụ = số phiếu', dem.chap_nhan_hoan.soVu === 1 && dem.chap_nhan_hoan.soTien === 0
        && Object.values(dem).reduce((s, v) => s + v.soVu, 0) === ds.length)
    const t1 = trangTheoKetCuc(ds, 'khieu_nai_thang', 1, 1)
    const t2 = trangTheoKetCuc(ds, 'khieu_nai_thang', 2, 1)
    ok('5d. cắt trang GIỮ thứ tự đầu vào: trang 1 = c · trang 2 = e · tổng 2',
        t1.ids.join() === 'c' && t2.ids.join() === 'e' && t1.total === 2 && t2.total === 2, { t1, t2 })
    const t9 = trangTheoKetCuc(ds, 'khieu_nai_thang', 9, 1)
    ok('5e. trang vượt quá → rỗng nhưng tổng vẫn đúng', t9.ids.length === 0 && t9.total === 2, t9)
}

/* 6 — route đã nối đúng hàm (soát mã nguồn) */
{
    const nguon = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'onlineOrders.ts'), 'utf8')
    const khuc = (dau: string) => {
        const i = nguon.indexOf(dau)
        const j = nguon.indexOf('\nrouter.', i + 10)
        return i < 0 ? '' : nguon.slice(i, j < 0 ? undefined : j)
    }
    const ds = khuc("router.get('/returns/list'")
    const tk = khuc("router.get('/returns/stats'")
    ok('6a. onlineOrders nhập lib/ketCucVuTra', /from '\.\.\/lib\/ketCucVuTra'/.test(nguon))
    ok('6b. /returns/list nhận ?ketCuc= qua laKetCucVuTra và cắt trang bằng trangTheoKetCuc',
        ds.includes('laKetCucVuTra(req.query.ketCuc)') && ds.includes('trangTheoKetCuc('))
    ok('6c. /returns/list trả ketCuc + ketCucChiTiet cho từng phiếu', ds.includes('ketCuc: kc.ketCuc') && ds.includes('ketCucChiTiet: kc.chiTiet'))
    ok('6d. /returns/stats trả theoKetCuc từ demTheoKetCuc (cùng luật với bộ lọc)', tk.includes('theoKetCuc: demTheoKetCuc('))
    ok('6e. /returns/stats lấy ghi chú bằng select gọn (không include items)', /findMany\(\{ where: onlineCode, select: \{ code: true, status: true, notes: true, totalRefund: true \} \}\)/.test(tk))
}

console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
if (hong > 0) process.exitCode = 1
