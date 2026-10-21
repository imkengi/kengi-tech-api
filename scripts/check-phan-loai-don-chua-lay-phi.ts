/**
 * Kiểm PHÂN LOẠI ĐƠN SÀN ĐÃ XOÁ MÀ SÀN KHÔNG TRẢ SỐ PHÍ — npx tsx scripts/check-phan-loai-don-chua-lay-phi.ts
 *
 * Bộ phân loại này là đầu vào để chủ shop quyết SỬA PHIẾU/KHO. Xếp nhầm nhóm là sửa
 * nhầm: coi đơn "giao thất bại" (hàng đã về shop) là "khách trả hàng" thì kho cộng hai
 * lần; coi "lỗi hỏi sàn" là "không tìm thấy" thì đơn thật bị kết luận oan. Nên bộ này
 * canh thứ tự luật, phân biệt sai-gian với lỗi thật, hết giờ không kết luận, và KHÔNG
 * có câu ghi nào (prisma giả không có $executeRawUnsafe — gọi là nổ).
 */
import {
    phanLoaiDon, laSaiGianShopee, maButToanCuaPhieu,
    SQL_PHIEU_CHUA_LAY_PHI, SQL_SO_KHO, SQL_BUT_TOAN, SQL_PHIEU_TRA, SQL_SO_KHO_ME,
} from '../src/lib/phanLoaiDonChuaLayPhi'
import { phanLoaiDonChuaLayPhi, type CongSan, type GianSan } from '../src/services/phanLoaiDonChuaLayPhi'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const sh = (x: any) => ({ san: 'shopee' as const, gianId: 'g', ...x })

async function main() {
    console.log('\n▶ Phân loại đơn sàn đã xoá mà sàn không trả số phí\n')

    /* 1 — luật phân loại. Ca 1a là đơn THẬT soi ngày 21/10/2026 (260820U1MS8UF3). */
    ok('1a. ca thật: COMPLETED + vận đơn DELIVERY_FAILED + hoàn cho khách âm + COD → GIAO THẤT BẠI (không phải hoàn tiền)',
        phanLoaiDon(sh({ trangThai: 'COMPLETED', vanDon: 'LOGISTICS_DELIVERY_FAILED', thucNhan: -2700, giaBan: 0, hoanChoKhach: -65500, thanhToan: 'Cash on Delivery' })).loai === 'giao-that-bai')
    ok('1b. COD bị từ chối nhận → giao thất bại', phanLoaiDon(sh({ trangThai: 'COMPLETED', vanDon: 'LOGISTICS_COD_REJECTED' })).loai === 'giao-that-bai')
    const huy = phanLoaiDon(sh({ trangThai: 'CANCELLED', huyBoi: 'buyer', lyDoHuy: 'Change of mind' }))
    ok('1c. sàn báo CANCELLED → huỷ, ghi ai huỷ', huy.loai === 'huy' && huy.lyDo.includes('buyer'), huy)
    ok('1d. IN_CANCEL → huỷ', phanLoaiDon(sh({ trangThai: 'IN_CANCEL' })).loai === 'huy')
    ok('1e. vận đơn PICKUP_FAILED → huỷ (hàng chưa rời shop)', phanLoaiDon(sh({ trangThai: 'COMPLETED', vanDon: 'LOGISTICS_PICKUP_FAILED' })).loai === 'huy')
    ok('1f. giao xong rồi hoàn tiền cho khách → hoàn tiền',
        phanLoaiDon(sh({ trangThai: 'COMPLETED', vanDon: 'LOGISTICS_DELIVERY_DONE', hoanChoKhach: -50000, thucNhan: 0 })).loai === 'hoan-tien')
    ok('1g. TO_RETURN → hoàn tiền', phanLoaiDon(sh({ trangThai: 'TO_RETURN', vanDon: 'LOGISTICS_DELIVERY_DONE' })).loai === 'hoan-tien')
    ok('1h. vận đơn LOST → thất lạc', phanLoaiDon(sh({ trangThai: 'COMPLETED', vanDon: 'LOGISTICS_LOST' })).loai === 'that-lac')
    ok('1i. giao xong, không hoàn gì, thực nhận ÂM → quyết toán âm',
        phanLoaiDon(sh({ trangThai: 'COMPLETED', vanDon: 'LOGISTICS_DELIVERY_DONE', thucNhan: -2700, hoanChoKhach: 0 })).loai === 'quyet-toan-am')
    ok('1j. không gian nào nhận → không tìm thấy', phanLoaiDon({ san: 'shopee', gianId: null }).loai === 'khong-tim-thay')
    ok('1k. có lỗi hỏi sàn → LỖI HỎI SÀN, kể cả khi không gian nào nhận (chưa được kết luận "không tìm thấy")',
        phanLoaiDon({ san: 'shopee', gianId: null, loiHoi: 'error_auth' }).loai === 'loi-hoi-san')
    ok('1l. TikTok COMPLETED chưa có dòng quyết toán → chưa quyết toán',
        phanLoaiDon({ san: 'tiktok', gianId: 't', trangThai: 'COMPLETED', soGiaoDichQuyetToan: 0 }).loai === 'chua-quyet-toan')
    ok('1m. TikTok CANCELLED → huỷ', phanLoaiDon({ san: 'tiktok', gianId: 't', trangThai: 'CANCELLED' }).loai === 'huy')
    ok('1n. có dữ liệu mà không khớp luật → khác (xem tay), không ép vào nhóm nào',
        phanLoaiDon(sh({ trangThai: 'COMPLETED', vanDon: 'LOGISTICS_DELIVERY_DONE', thucNhan: 0, giaBan: 0 })).loai === 'khac')

    /* 2 — sai gian ≠ lỗi thật. */
    ok('2a. error_not_found → sai gian', laSaiGianShopee({ error: 'error_not_found', message: 'Wrong parameters, detail: the order is not found.' }))
    ok('2b. "does not belong to you" → sai gian', laSaiGianShopee({ error: 'order_not_found', message: 'Order SN provided is invalid or does not belong to you.' }))
    ok('2c. lỗi token → KHÔNG phải sai gian', !laSaiGianShopee({ error: 'error_auth', message: 'Invalid access_token.' }))
    ok('2d. bị giới hạn lượt → KHÔNG phải sai gian', !laSaiGianShopee({ error: 'error_server', message: 'Too many requests' }))
    const refs = maButToanCuaPhieu('ONLINE-SPE-A')
    ok('2e. đủ 5 tiền tố bút toán + 5 bản đảo REV-', refs.length === 10 && refs.includes('SALE-ONLINE-SPE-A') && refs.includes('REV-COGS-ONLINE-SPE-A'), refs)

    /* 3 — chạy cả luồng với sàn giả + sổ giả. */
    const gian: GianSan[] = [
        { id: 'tools', name: 'Kengi Tools', platform: 'shopee', accessToken: 'x' },
        { id: 'store', name: 'Kengi Store', platform: 'shopee', accessToken: 'x' },
        { id: 'tt', name: 'Kengi Store TT', platform: 'tiktok', accessToken: 'x' },
    ]
    const phieu = [
        { orderNumber: 'SPE-A', platform: 'shopee', receiptNumber: 'ONLINE-SPE-A', total: 73500, status: 'completed', transactionDate: new Date('2026-08-20T12:51:24Z'), createdAt: new Date('2026-08-20T13:00:00Z'), vatStatus: 'issued', coSoHoaDon: true },
        { orderNumber: 'SPE-B', platform: 'shopee', receiptNumber: 'ONLINE-SPE-B', total: 50000, status: 'completed', transactionDate: new Date('2026-08-10T03:00:00Z'), createdAt: new Date('2026-08-10T03:00:00Z'), vatStatus: 'none', coSoHoaDon: false },
        { orderNumber: 'SPE-C', platform: 'shopee', receiptNumber: 'ONLINE-SPE-C', total: 90000, status: 'completed', transactionDate: new Date('2026-07-10T03:00:00Z'), createdAt: new Date('2026-07-10T03:00:00Z'), vatStatus: 'none', coSoHoaDon: false },
        { orderNumber: 'TIK-1', platform: 'tiktok', receiptNumber: 'ONLINE-TIK-1', total: 120000, status: 'completed', transactionDate: new Date('2026-07-01T03:00:00Z'), createdAt: new Date('2026-07-01T03:00:00Z'), vatStatus: 'none', coSoHoaDon: false },
        { orderNumber: 'TIK-2', platform: 'tiktok', receiptNumber: 'ONLINE-TIK-2', total: 80000, status: 'completed', transactionDate: new Date('2026-07-02T03:00:00Z'), createdAt: new Date('2026-07-02T03:00:00Z'), vatStatus: 'none', coSoHoaDon: false },
    ]
    const sqlDaDoc: string[] = []
    const db = {
        async $queryRawUnsafe(sql: string, ...p: any[]): Promise<any> {
            sqlDaDoc.push(sql)
            if (sql === SQL_PHIEU_CHUA_LAY_PHI) return phieu.slice(p[0], p[0] + p[1]).map(r => ({ ...r, tong: phieu.length }))
            if (sql === SQL_SO_KHO) return (p[0] as string[]).includes('ONLINE-SPE-A') ? [{ ref: 'ONLINE-SPE-A', rong: -2, da_tru: -2, da_hoan: 0 }] : []
            if (sql === SQL_BUT_TOAN) return ['SALE-ONLINE-SPE-A', 'COGS-ONLINE-SPE-A', 'REV-COGS-ONLINE-SPE-A']
                .filter(r => (p[0] as string[]).includes(r)).map(reference => ({ reference }))
            if (sql === SQL_PHIEU_TRA) return (p[0] as string[]).includes('A') ? [{ code: 'RTN-SH-9', status: 'pending', originalInvoice: 'A', refundAmount: 0 }] : []
            throw new Error('câu đọc lạ: ' + sql.slice(0, 50))
        },
        onlineChannel: { async findMany() { return gian } },
        onlineOrder: { async groupBy() { return [{ channelId: 'store', _count: { _all: 2468 } }, { channelId: 'tools', _count: { _all: 248 } }] } },
    }
    const khoMe = {
        maCon: 'KENGISTORE',
        sp: { async $queryRawUnsafe(sql: string, refs: string[]) {
            if (sql !== SQL_SO_KHO_ME) throw new Error('kho mẹ: câu lạ')
            return refs.includes('KENGISTORE:SPE-A') ? [{ ref: 'KENGISTORE:SPE-A', rong: -1 }] : []
        } },
    }
    const hoi: string[] = []
    const taoCong = (g: GianSan): CongSan => ({
        async escrowShopee(sn) {
            hoi.push(`${g.id}:${sn}`)
            if (g.id === 'tools' && sn === 'A') return { saiGian: false, du: { thucNhan: -2700, giaBan: 0, hoanChoKhach: -65500, thanhToan: 'Cash on Delivery' } }
            if (g.id === 'store' && sn === 'C') return { saiGian: false, loi: 'error_auth Invalid access_token' }
            return { saiGian: true }
        },
        async vanDonShopee(sn) { return sn === 'A' ? 'LOGISTICS_DELIVERY_FAILED' : undefined },
        async chiTiet(ma) {
            const m = new Map<string, any>()
            if (g.id === 'tools' && ma.includes('A')) m.set('A', { trangThai: 'COMPLETED' })
            if (g.id === 'tt' && ma.includes('1')) m.set('1', { trangThai: 'CANCELLED', huyBoi: 'BUYER' })
            return m
        },
        async quyetToanTikTok() { return { soGiaoDich: 0, thucNhan: null } },
    })

    const kq = await phanLoaiDonChuaLayPhi(db as any, { tu: 0, gioiHan: 50, hanMs: 60_000, khoMe, nghiTikTokMs: 0 }, taoCong)
    const theo = (ma: string) => kq.don.find(d => d.ma === ma)!
    ok('3a. gian nhiều đơn (Kengi Store) hỏi TRƯỚC, sai gian thì hỏi gian kế', hoi.indexOf('store:A') < hoi.indexOf('tools:A'), hoi)
    ok('3b. đơn A → giao thất bại, đúng gian Kengi Tools', theo('SPE-A').loai === 'giao-that-bai' && theo('SPE-A').gian === 'Kengi Tools', theo('SPE-A'))
    ok('3c. đơn B (mọi gian sai gian) → không tìm thấy', theo('SPE-B').loai === 'khong-tim-thay')
    ok('3d. đơn C (một gian lỗi token, gian kia sai gian) → LỖI HỎI SÀN, không kết luận', theo('SPE-C').loai === 'loi-hoi-san', theo('SPE-C'))
    ok('3e. TikTok: tìm thấy + CANCELLED → huỷ; không gian nào trả → không tìm thấy',
        theo('TIK-1').loai === 'huy' && theo('TIK-2').loai === 'khong-tim-thay', [theo('TIK-1'), theo('TIK-2')])
    const a = theo('SPE-A')
    ok('3f. sổ của phiếu A: còn trừ kho 2, bút toán SALE chưa đảo (COGS đã đảo), có HĐ, có phiếu trả từ sàn, kho mẹ còn trừ',
        a.kho.daTru === -2 && a.butToan.goc === 2 && a.butToan.daDao === 1 && a.coSoHoaDon && a.phieuTra[0]?.code === 'RTN-SH-9' && a.khoMeRong === -1, a)
    const g = kq.theoLoai['giao-that-bai']
    ok('3g. tổng theo nhóm: 1 đơn, 73.500đ, có HĐ, còn bút toán, còn trừ kho, kho mẹ còn trừ, có phiếu trả',
        g?.soDon === 1 && g.tienPhieu === 73500 && g.coHoaDon === 1 && g.conButToanChuaDao === 1 && g.conTruKho === 1 && g.khoMeConTru === 1 && g.coPhieuTra === 1, g)
    ok('3h. ngày bán theo giờ VN', a.ngayBan === '2026-08-20' && theo('TIK-1').thangTaoPhieu === '2026-07')
    ok('3i. CHỈ ĐỌC: không có câu nào ngoài 5 câu SELECT đã khai', sqlDaDoc.every(s => [SQL_PHIEU_CHUA_LAY_PHI, SQL_SO_KHO, SQL_BUT_TOAN, SQL_PHIEU_TRA].includes(s)) && !('$executeRawUnsafe' in db))
    ok('3j. đếm đủ: 5 phiếu, xét 5, hết giờ 0', kq.tong === 5 && kq.daXet === 5 && kq.hetGio === 0, { tong: kq.tong, daXet: kq.daXet, hetGio: kq.hetGio })

    /* 4 — hết giờ: không được kết luận gì cho đơn chưa hỏi. */
    const kq2 = await phanLoaiDonChuaLayPhi(db as any, { tu: 0, gioiHan: 50, hanMs: -1, khoMe: null, nghiTikTokMs: 0 }, taoCong)
    ok('4a. hết giờ ngay từ đầu → không phiếu nào bị kết luận (kể cả TikTok "không tìm thấy")', kq2.daXet === 0 && kq2.don.length === 0, kq2.don.map(d => `${d.ma}:${d.loai}`))
    ok('4b. hết giờ được đếm đủ 5 (3 Shopee + 2 TikTok)', kq2.hetGio === 5, kq2.hetGio)

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
