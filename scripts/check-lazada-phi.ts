/**
 * check-lazada-phi — lấy phí thật của đơn Lazada (14/11/2026, chủ shop duyệt bước 1 trước Lazada Pilot).
 *
 *  E. docGiaoDichTaiChinh (QueryTransactionDetails) với httpGet giả: kiểm ngày YYYY-MM-DD + khoảng < 180 ngày TRƯỚC khi gọi,
 *     lật trang 500 dòng theo offset, chỉ gửi đúng tham số, lỗi Lazada ném nguyên văn, chạm giới hạn trang thì báo catTai.
 *  F. Map dòng giao dịch → phí / thực nhận (lib/phiLazada) trên ĐÚNG hình dạng đo 14/11/2026: số tiền là chuỗi có dấu phẩy,
 *     đơn giao thường, đơn trả lỗ, đơn trả hoà, thiếu dòng tiền hàng / số tiền hỏng / phí âm ⇒ KHÔNG ghi (không ước tính).
 *  G. Chia khoảng ngày ≤ 179 ngày KHÔNG chồng nhau (Lazada tính cả hai đầu khoảng — chồng là đếm một dòng hai lần).
 *  H. Lõi doiSoatPhiLazada với prisma giả (theo select) + Lazada giả: chạy thử không ghi gì; apply chỉ ghi đơn có số KHÁC;
 *     chạy lại hội tụ (0 ghi); đơn huỷ không đụng; vuaCoPhi chỉ đơn từ 0/0; phiếu mất gốc ⇒ PhiSanDon, không đè số đã có;
 *     đọc chưa hết ⇒ không ghi đơn nào; không có gì để soát ⇒ không gọi Lazada.
 *
 * Không gọi mạng, không đụng CSDL. Chạy: npm run check:lazada-phi
 */
import { LazadaService } from '../src/services/platforms/lazada'
import {
    soTienLazada, laDongTienHang, gomTheoDonLazada, soPhiTuGom, chiaKhoangNgay, ngayVN, doiSoatPhiLazada,
} from '../src/lib/phiLazada'
import { SQL_GHI_LAY_DUOC } from '../src/lib/phiSanGiuLai'

let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }

const KHOA_CHUNG = ['app_key', 'timestamp', 'sign_method', 'access_token', 'sign']
const dongGD = (i: number, them: any = {}) => ({
    order_no: String(400000000000 + Math.floor(i / 4)), orderItem_no: String(500000000000 + i), amount: '-1000.00',
    transaction_type: 'Payment Fee', fee_name: 'Payment Fee', fee_type: '13', paid_status: 'Not paid',
    transaction_date: '12 Nov 2026', statement: '10 Nov 2026 - 16 Nov 2026', ...them,
})

/* ── Dòng giao dịch giả theo ĐÚNG hình dạng đo 14/11/2026 (mã đơn giả — repo công khai) ── */
const THANG = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ngayLz = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d} ${THANG[Number(m) - 1]} ${y}` }
/** 43559 → "43,559.00", -43559 → "-43,559.00" — Lazada trả số tiền dạng CHUỖI có dấu phẩy nghìn */
const tienLz = (n: number) => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function dongLz(don: string, iso: string, ma: string, ten: string, loai: string, so: number): any {
    return {
        order_no: don, orderItem_no: `${don}01`, amount: tienLz(so), fee_type: ma, fee_name: ten, transaction_type: loai,
        transaction_date: ngayLz(iso), statement: `${ngayLz(iso)} - ${ngayLz(iso)}`, paid_status: 'paid', WHT_included_in_amount: 'No',
        _iso: iso,   // chỉ để Lazada giả lọc theo khoảng ngày
    }
}
/** Đơn giao bình thường: tiền hàng + các khoản khấu trừ đo được (hoa hồng, thanh toán, chiến dịch, xu, hạ tầng 3.000, thuế 1% + 0,5%) */
function donGiao(ma: string, iso: string, gia: number) {
    const phan = {
        hoaHong: Math.round(gia * 0.12), thanhToan: Math.round(gia * 0.04), chienDich: Math.round(gia * 0.05),
        xu: Math.round(gia * 0.02), haTang: 3000, vat: Math.round(gia * 0.01), pit: Math.round(gia * 0.005),
    }
    const phi = Object.values(phan).reduce((a, b) => a + b, 0)
    const dong = [
        dongLz(ma, iso, '13', 'Item Price Credit', 'Orders-Sales', gia),
        dongLz(ma, iso, '16', 'Commission', 'Orders-Lazada Fees', -phan.hoaHong),
        dongLz(ma, iso, '3', 'Payment Fee', 'Orders-Lazada Fees', -phan.thanhToan),
        dongLz(ma, iso, '515', 'Campaign Fee', 'Orders-Lazada Fees', -phan.chienDich),
        dongLz(ma, iso, '306', 'LazCoins Discount', 'Orders-Marketing Fees', -phan.xu),
        dongLz(ma, iso, '5268', 'Infrastructure Fee - Auto', 'Orders-Sales', -phan.haTang),
        dongLz(ma, iso, '5250', 'Withholding tax - VAT', 'Orders-Withholding Taxes', -phan.vat),
        dongLz(ma, iso, '5252', 'Withholding tax - PIT', 'Orders-Withholding Taxes', -phan.pit),
    ]
    return { ma, gia, phi, thuc: gia - phi, phan, dong }
}
/** Khách trả: sàn đảo tiền hàng + hoàn các khoản phí, shop chịu phí ship trả về + voucher vận chuyển ⇒ thực nhận ÂM */
function traHang(ban: ReturnType<typeof donGiao>, iso: string, phiShipTra: number, voucher: number) {
    const p = ban.phan
    const dong = [
        dongLz(ban.ma, iso, '14', 'Reversal Item Price', 'Refunds-Sales', -ban.gia),
        dongLz(ban.ma, iso, '15', 'Reversal Commission', 'Refunds-Lazada Fees', p.hoaHong),
        dongLz(ban.ma, iso, '4', 'Payment Fee Credit', 'Refunds-Lazada Fees', p.thanhToan),
        dongLz(ban.ma, iso, '516', 'Reversal Campaign Fee', 'Refunds-Lazada Fees', p.chienDich),
        dongLz(ban.ma, iso, '307', 'Reversal LazCoins Discount', 'Refunds-Marketing Fees', p.xu),
        dongLz(ban.ma, iso, '5269', 'Reversal Infrastructure Fee - Auto', 'Refunds-Sales', p.haTang),
        dongLz(ban.ma, iso, '5251', 'Reversal Withholding tax - VAT', 'Refunds-Withholding Taxes', p.vat),
        dongLz(ban.ma, iso, '5253', 'Reversal Withholding tax - PIT', 'Refunds-Withholding Taxes', p.pit),
        dongLz(ban.ma, iso, '1128', 'Customer Return Delivery Fee', 'Refunds-Lazada Fees', -phiShipTra),
        dongLz(ban.ma, iso, '520', 'Shipping Fee Voucher Refund to Laz', 'Refunds-Lazada Fees', -voucher),
    ]
    return { dong, thucSauTra: -(phiShipTra + voucher) }
}
const DON_A = donGiao('900000000000001', '2026-03-28', 159_500)
const DON_B = donGiao('900000000000002', '2026-09-20', 245_000)          // ngày CUỐI của khoảng đọc thứ nhất
const DON_C_BAN = donGiao('900000000000003', '2026-09-20', 120_000)
const DON_C_TRA = traHang(DON_C_BAN, '2026-09-21', 25_000, 8_000)        // ngày ĐẦU của khoảng đọc thứ hai
const DON_D = donGiao('900000000000004', '2026-09-03', 99_000)
const DON_E = { ma: '900000000000005', dong: [dongLz('900000000000005', '2026-10-05', '13', 'Item Price Credit', 'Orders-Sales', 50_000)] }
const DON_P1 = donGiao('900000000000008', '2026-04-05', 75_000)
const DON_P2 = donGiao('900000000000009', '2026-05-12', 60_000)

const donKengi = (id: string, ma: string, tao: string, status: string, phi: number, thuc: number) => ({
    id, channelId: 'kenh-lz', externalOrderId: ma, orderNumber: `LZD-${ma}`, status, total: 1, platformFee: phi, netRevenue: thuc,
    createdAt: new Date(tao), note: null,
})

/** Prisma giả — trả ĐÚNG các cột được select (prisma giả không theo select từng báo oan 1.944 đơn) */
function taoDbGia(don: any[], phieu: Array<{ orderNumber: string; ngay: Date }>, phiSanDon: Map<string, { phi: number; thuc: number }>) {
    const capNhat: any[] = [], ghiPhiSan: any[] = []
    const chon = (o: any, select: any) => select ? Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, o[k]])) : { ...o }
    const db = {
        onlineOrder: {
            findMany: async ({ where, select, orderBy }: any) => {
                let r = don.filter(o => o.channelId === where.channelId
                    && !(where.status?.notIn || []).includes(o.status)
                    && (where.externalOrderId?.not === null ? o.externalOrderId != null : true)
                    && (!where.createdAt?.gte || o.createdAt >= where.createdAt.gte))
                if (orderBy?.createdAt === 'asc') r = [...r].sort((a, b) => a.createdAt - b.createdAt)
                return r.map(o => chon(o, select))
            },
            update: async ({ where, data }: any) => {
                capNhat.push({ id: where.id, ...data })
                const o = don.find(x => x.id === where.id)
                Object.assign(o, data)
                return o
            },
        },
        $queryRawUnsafe: async (sql: string) => {
            if (!/ONLINE-LZD-%/.test(sql) || !/o\.id IS NULL/.test(sql) || !/'voided', 'returned'/.test(sql)) throw new Error('bộ kiểm: câu SQL ngoài dự kiến')
            return phieu.map(p => {
                const f = phiSanDon.get(p.orderNumber)
                return { orderNumber: p.orderNumber, ngay: p.ngay, phiGiu: f ? f.phi : null, thucGiu: f ? f.thuc : null }
            })
        },
        $executeRawUnsafe: async (sql: string, ma: string[], san: string[], phi: number[], thuc: number[], kenh: string[]) => {
            ghiPhiSan.push({ sql, ma, san, phi, thuc, kenh })
            ma.forEach((m, i) => { const f = phiSanDon.get(m); if (!f || f.thuc === 0) phiSanDon.set(m, { phi: phi[i], thuc: thuc[i] }) })
            return ma.length
        },
    }
    return { db, capNhat, ghiPhiSan }
}

/** Lazada giả: trả dòng có ngày trong [tu, den] (tính cả hai đầu — như Lazada thật), ghi lại từng lượt gọi */
function taoLazadaGia(dong: any[], catTaiKhi?: (k: { tu: string; den: string }) => boolean) {
    const goi: Array<{ tu: string; den: string }> = []
    const svc = {
        docGiaoDichTaiChinh: async ({ tu, den }: { tu: string; den: string }) => {
            goi.push({ tu, den })
            const r = dong.filter(d => d._iso >= tu && d._iso <= den)
            return catTaiKhi?.({ tu, den }) ? { dong: r.slice(0, 1), catTai: `mới đọc ${Math.min(1, r.length)} dòng (giới hạn 1 trang của lượt đọc)` } : { dong: r }
        },
    }
    return { goi, svc }
}

async function main() {
    // ─── E. docGiaoDichTaiChinh ──────────────────────────────────────────────────
    {
        const svc: any = new LazadaService({ apiKey: 'k', apiSecret: 's', accessToken: 't' } as any)
        let goi = 0
        svc.httpGet = async () => { goi++; return { code: '0', data: [] } }
        const nem = async (o: any) => { try { await svc.docGiaoDichTaiChinh(o); return '' } catch (e: any) { return String(e?.message || e) } }
        const l1 = await nem({ tu: '2026/11/01', den: '2026-11-14' })
        const l2 = await nem({ tu: '2026-01-01', den: '2026-11-14' })
        const l3 = await nem({ tu: '2026-11-14', den: '2026-11-01' })
        ca('E1 ngày sai dạng / khoảng > 179 ngày / đảo ngược ⇒ NÉM, KHÔNG gọi Lazada lần nào',
            /YYYY-MM-DD/.test(l1) && /317 ngày/.test(l2) && /-13 ngày/.test(l3) && goi === 0, JSON.stringify({ l1, l2, l3, goi }))
        const l4 = await nem({ tu: '2026-05-19', den: '2026-11-14' })
        ca('E2 đúng 179 ngày ⇒ được gọi', l4 === '' && goi === 1, JSON.stringify({ l4, goi }))

        const tatCa = Array.from({ length: 1234 }, (_, i) => dongGD(i))
        const thamSo: string[] = [], offsets: number[] = []
        svc.httpGet = async (url: string) => {
            const u = new URL(url)
            if (!u.pathname.endsWith('/finance/transaction/details/get')) throw new Error('bộ kiểm: lời gọi ngoài dự kiến ' + u.pathname)
            thamSo.push([...u.searchParams.keys()].filter(k => !KHOA_CHUNG.includes(k)).sort().join(','))
            const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'))
            offsets.push(off)
            return { code: '0', data: tatCa.slice(off, off + lim) }
        }
        const r = await svc.docGiaoDichTaiChinh({ tu: '2026-10-15', den: '2026-11-14' })
        ca('E3 lật trang offset 0, 500, 1000 (limit 500) rồi dừng khi trang thiếu — đủ 1234 dòng, không catTai',
            offsets.join() === '0,500,1000' && r.dong.length === 1234 && !r.catTai, JSON.stringify({ offsets, n: r.dong.length, catTai: r.catTai }))
        ca('E4 chỉ gửi start_time / end_time / offset / limit khi không lọc', thamSo.every(t => t === 'end_time,limit,offset,start_time'), JSON.stringify(thamSo))
        thamSo.length = 0; offsets.length = 0
        await svc.docGiaoDichTaiChinh({ tu: '2026-10-15', den: '2026-11-14', maDon: '400000000001', loai: '-1' })
        ca('E5 lọc theo đơn + loại ⇒ thêm trade_order_id / trans_type', thamSo[0] === 'end_time,limit,offset,start_time,trade_order_id,trans_type', JSON.stringify(thamSo))
        offsets.length = 0
        const cat = await svc.docGiaoDichTaiChinh({ tu: '2026-10-15', den: '2026-11-14', toiDaTrang: 2 })
        ca('E6 chạm giới hạn trang ⇒ trả phần đã đọc KÈM catTai (không giả là đủ)',
            cat.dong.length === 1000 && /1000 dòng/.test(cat.catTai || '') && offsets.join() === '0,500', JSON.stringify({ n: cat.dong.length, catTai: cat.catTai, offsets }))

        svc.httpGet = async () => ({ code: 'IllegalAccessToken', message: 'The specified access token is invalid or expired' })
        const l5 = await nem({ tu: '2026-10-15', den: '2026-11-14' })
        ca('E7 lỗi token ⇒ NÉM "Lazada từ chối kênh" + nguyên văn', /Lazada từ chối kênh: \[IllegalAccessToken\] The specified access token is invalid/.test(l5), l5)
        svc.httpGet = async (url: string) => Number(new URL(url).searchParams.get('offset')) === 500
            ? { code: '1000012', message: 'endTime - startTime must should be less than 180 days' }
            : { code: '0', data: tatCa.slice(0, 500) }
        const l6 = await nem({ tu: '2026-10-15', den: '2026-11-14' })
        ca('E8 hỏng giữa chừng ⇒ NÉM kèm khoảng ngày, offset, mã + lời Lazada (không trả nửa danh sách)',
            /finance\/transaction\/details\/get \(2026-10-15 → 2026-11-14, offset 500\): \[1000012\] endTime - startTime/.test(l6), l6)
        svc.httpGet = async () => ({ code: 0, data: null })
        const rong = await svc.docGiaoDichTaiChinh({ tu: '2026-11-14', den: '2026-11-14' })
        ca('E9 code số 0 + data null ⇒ không dòng nào, không lỗi (0 ngày là khoảng hợp lệ)', rong.dong.length === 0 && !rong.catTai, JSON.stringify(rong))
    }

    // ─── F. Map dòng → phí / thực nhận ───────────────────────────────────────────
    {
        ca('F1 "-43,559.00" / "159,500.00" / số ⇒ đúng số; rỗng / chữ / null ⇒ null (KHÔNG coi là 0)',
            soTienLazada('-43,559.00') === -43559 && soTienLazada('159,500.00') === 159500 && soTienLazada(12) === 12
            && soTienLazada('') === null && soTienLazada('abc') === null && soTienLazada(null) === null && soTienLazada(undefined) === null
            && soTienLazada('1.5e3') === null && soTienLazada(NaN) === null)
        ca('F2 dòng tiền hàng = mã 13 / 14 hoặc tên Item Price Credit / Reversal Item Price; phí (16) thì không',
            laDongTienHang({ fee_type: '13' }) && laDongTienHang({ fee_type: 14 }) && laDongTienHang({ fee_name: ' Item Price Credit ' })
            && laDongTienHang({ fee_name: 'reversal item price' }) && !laDongTienHang({ fee_type: '16', fee_name: 'Commission' }))

        const g = gomTheoDonLazada([...DON_A.dong, ...DON_C_BAN.dong, ...DON_C_TRA.dong, { amount: '-50,000.00', fee_name: 'Top-up' }])
        const a = soPhiTuGom(g.get(DON_A.ma))
        ca('F3 đơn giao thường: phí = tiền hàng − thực nhận (gồm thuế khấu trừ, phí hạ tầng 3.000), thực nhận = Σ mọi dòng',
            'platformFee' in a && a.platformFee === DON_A.phi && a.netRevenue === DON_A.thuc && DON_A.phi > 0 && g.get(DON_A.ma)!.tienHang === DON_A.gia,
            JSON.stringify({ a, ky: { phi: DON_A.phi, thuc: DON_A.thuc } }))
        const c = soPhiTuGom(g.get(DON_C_BAN.ma))
        ca('F4 đơn trả có lỗ (phí trả hàng): tiền hàng 0, thực nhận ÂM, phí = −thực nhận — không giấu lỗ',
            'platformFee' in c && c.netRevenue === DON_C_TRA.thucSauTra && c.netRevenue < 0 && c.platformFee === -DON_C_TRA.thucSauTra
            && g.get(DON_C_BAN.ma)!.tienHang === 0 && g.get(DON_C_BAN.ma)!.ngay.length === 2, JSON.stringify({ c, g: g.get(DON_C_BAN.ma) }))
        ca('F5 dòng không có order_no (nạp ví, phí cả gian) bị bỏ, không thành đơn rỗng', g.size === 2 && !g.has(''))
        const hoa = gomTheoDonLazada([
            dongLz('h1', '2026-05-01', '13', 'Item Price Credit', 'Orders-Sales', 100_000),
            dongLz('h1', '2026-05-01', '16', 'Commission', 'Orders-Lazada Fees', -10_000),
            dongLz('h1', '2026-05-09', '14', 'Reversal Item Price', 'Refunds-Sales', -100_000),
            dongLz('h1', '2026-05-09', '15', 'Reversal Commission', 'Refunds-Lazada Fees', 10_000),
        ])
        const h = soPhiTuGom(hoa.get('h1'))
        ca('F6 đơn trả hoàn hết (sàn trả lại phí) ⇒ 0 / 0', 'platformFee' in h && h.platformFee === 0 && h.netRevenue === 0, JSON.stringify(h))
        const thieu = soPhiTuGom(gomTheoDonLazada([dongLz('t1', '2026-05-01', '16', 'Commission', 'Orders-Lazada Fees', -10_000)]).get('t1'))
        ca('F7 chỉ có dòng phí, thiếu dòng tiền hàng ⇒ KHÔNG ghi, nói lý do', 'boQua' in thieu && /Item Price Credit/.test(thieu.boQua) && !thieu.chuaQuyetToan)
        const hong1 = soPhiTuGom(gomTheoDonLazada([
            dongLz('x1', '2026-05-01', '13', 'Item Price Credit', 'Orders-Sales', 100_000),
            { ...dongLz('x1', '2026-05-01', '16', 'Commission', 'Orders-Lazada Fees', -1), amount: 'N/A' },
        ]).get('x1'))
        ca('F8 một dòng số tiền không đọc được ⇒ KHÔNG ghi nửa số', 'boQua' in hong1 && /không đọc được/.test(hong1.boQua))
        const am = soPhiTuGom(gomTheoDonLazada([
            dongLz('m1', '2026-05-01', '13', 'Item Price Credit', 'Orders-Sales', 100_000),
            dongLz('m1', '2026-05-01', '4', 'Payment Fee Credit', 'Refunds-Lazada Fees', 5_000),
        ]).get('m1'))
        ca('F9 phí tính ra ÂM (thiếu dòng phí) ⇒ KHÔNG ghi', 'boQua' in am && /ÂM/.test(am.boQua))
        const chua = soPhiTuGom(undefined)
        ca('F10 Lazada chưa có dòng nào của đơn ⇒ "chưa quyết toán" (không phải lỗi)', 'boQua' in chua && chua.chuaQuyetToan === true)
    }

    // ─── G. Chia khoảng ngày ─────────────────────────────────────────────────────
    {
        const k = chiaKhoangNgay('2026-03-25', '2026-11-14')
        ca('G1 03-25 → 11-14 ⇒ [03-25 → 09-20] + [09-21 → 11-14]: khoảng sau bắt đầu NGÀY SAU, không chồng',
            JSON.stringify(k) === JSON.stringify([{ tu: '2026-03-25', den: '2026-09-20' }, { tu: '2026-09-21', den: '2026-11-14' }]), JSON.stringify(k))
        const dai = chiaKhoangNgay('2024-01-01', '2026-11-14')
        const ngay = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86400_000
        const deu = dai.every((x, i) => ngay(x.den) - ngay(x.tu) <= 179 && ngay(x.den) >= ngay(x.tu) && (i === 0 || ngay(x.tu) === ngay(dai[i - 1].den) + 1))
        ca('G2 khoảng dài: mọi khoảng ≤ 179 ngày, nối liền, phủ đúng hai đầu', deu && dai[0].tu === '2024-01-01' && dai[dai.length - 1].den === '2026-11-14', JSON.stringify(dai))
        ca('G3 một ngày ⇒ một khoảng; đảo ngược / sai dạng ⇒ rỗng',
            JSON.stringify(chiaKhoangNgay('2026-11-14', '2026-11-14')) === '[{"tu":"2026-11-14","den":"2026-11-14"}]'
            && chiaKhoangNgay('2026-11-14', '2026-11-01').length === 0 && chiaKhoangNgay('x', '2026-11-01').length === 0)
        ca('G4 ngày theo giờ VN: 13/11 17:30Z = 14/11 ở VN', ngayVN(new Date('2026-11-13T17:30:00Z')) === '2026-11-14' && ngayVN(new Date('2026-11-13T16:59:00Z')) === '2026-11-13')
    }

    // ─── H. Lõi đối soát với prisma giả + Lazada giả ─────────────────────────────
    {
        const BAY_GIO = new Date('2026-11-14T03:00:00Z')
        const kenh = { id: 'kenh-lz' }
        const taoDon = () => [
            donKengi('a', DON_A.ma, '2026-03-26T02:00:00Z', 'delivered', 0, 0),
            donKengi('b', DON_B.ma, '2026-09-17T05:00:00Z', 'confirmed', 0, 0),
            donKengi('c', DON_C_BAN.ma, '2026-08-20T03:00:00Z', 'delivered', DON_C_BAN.phi, DON_C_BAN.thuc),   // có số trước khi khách trả
            donKengi('d', DON_D.ma, '2026-09-01T03:00:00Z', 'delivered', DON_D.phi, DON_D.thuc),               // số đã đúng
            donKengi('e', DON_E.ma, '2026-10-03T03:00:00Z', 'cancelled', 0, 0),                                // huỷ — có dòng lạ vẫn không đụng
            donKengi('f', '900000000000006', '2026-11-10T03:00:00Z', 'delivered', 0, 0),                        // Lazada chưa quyết toán
            donKengi('g', '900000000000007', '2026-06-01T03:00:00Z', 'delivered', 0, 0),                        // chỉ có dòng phí
            { ...donKengi('k', DON_A.ma, '2026-04-01T00:00:00Z', 'delivered', 0, 0), channelId: 'kenh-khac' },  // kênh khác
        ]
        const taoPhieu = () => [
            { orderNumber: `LZD-${DON_P1.ma}`, ngay: new Date('2026-04-02T03:00:00Z') },
            { orderNumber: `LZD-${DON_P2.ma}`, ngay: new Date('2026-05-10T03:00:00Z') },
            { orderNumber: 'LZD-900000000000010', ngay: new Date('2026-05-12T03:00:00Z') },
        ]
        const dongLazada = [
            ...DON_A.dong, ...DON_B.dong, ...DON_C_BAN.dong, ...DON_C_TRA.dong, ...DON_D.dong, ...DON_E.dong, ...DON_P1.dong, ...DON_P2.dong,
            dongLz('900000000000007', '2026-06-05', '16', 'Commission', 'Orders-Lazada Fees', -9_000),
            ...donGiao('900000000000099', '2026-07-01', 80_000).dong,                       // đơn trước khi nối kênh
            { amount: '-50,000.00', fee_name: 'Sponsored Solutions Top-up', _iso: '2026-07-02' },   // không order_no
        ]
        const phiSanDon = new Map<string, { phi: number; thuc: number }>([[`LZD-${DON_P2.ma}`, { phi: 1, thuc: 2 }]])
        const don = taoDon()
        const { db, capNhat, ghiPhiSan } = taoDbGia(don, taoPhieu(), phiSanDon)
        const lz = taoLazadaGia(dongLazada)

        const thu = await doiSoatPhiLazada(db, kenh, lz.svc, { apply: false, phieuMatGoc: true, bayGio: BAY_GIO })
        ca('H1 CHẠY THỬ: đếm đủ (3 sẽ ghi, 1 giống, 1 chưa có, 2 bỏ qua có lý do) mà KHÔNG ghi gì',
            thu.quet === 6 && thu.seGhi === 3 && thu.daGhi === 0 && thu.giongNhau === 1 && thu.chuaCo === 1 && thu.boQua.length === 2
            && capNhat.length === 0 && ghiPhiSan.length === 0 && thu.phieuMatGoc?.seGhi === 1 && thu.phieuMatGoc?.daGhi === 0 && thu.vuaCoPhi.length === 0,
            JSON.stringify({ ...thu, mau: undefined }))
        ca('H2 một lượt đọc từ (đơn / phiếu cũ nhất − 1 ngày, giờ VN) tới hôm nay, chia 2 khoảng không chồng',
            JSON.stringify(lz.goi) === JSON.stringify([{ tu: '2026-03-25', den: '2026-09-20' }, { tu: '2026-09-21', den: '2026-11-14' }])
            && thu.khoang?.tu === '2026-03-25' && thu.khoang?.den === '2026-11-14', JSON.stringify(lz.goi))
        const tienBan = DON_A.gia + DON_B.gia + DON_D.gia, phiBan = DON_A.phi + DON_B.phi + DON_D.phi
        ca('H3 tổng: tiền hàng / phí / thực nhận cộng đúng; tỷ lệ phí chỉ tính đơn còn tiền hàng (đơn trả không kéo tỷ lệ)',
            thu.tong.tienHang === tienBan && thu.tong.phi === phiBan - DON_C_TRA.thucSauTra
            && thu.tong.thucNhan === DON_A.thuc + DON_B.thuc + DON_D.thuc + DON_C_TRA.thucSauTra
            && thu.tong.tyLePhi === Math.round(phiBan / tienBan * 10000) / 100, JSON.stringify(thu.tong))
        ca('H4 bỏ qua có LÝ DO: đơn chỉ có dòng phí; phiếu mất gốc đã có số khác ⇒ không đè',
            thu.boQua.some(b => b.orderNumber === 'LZD-900000000000007' && /Item Price Credit/.test(b.lyDo))
            && thu.boQua.some(b => b.orderNumber === `LZD-${DON_P2.ma}` && /không đè/.test(b.lyDo)), JSON.stringify(thu.boQua))
        ca('H5 order_no có giao dịch mà không thuộc đợt soát (đơn trước khi nối kênh, đơn huỷ) chỉ được ĐẾM', thu.ngoaiDotSoat === 2, String(thu.ngoaiDotSoat))

        const ghi = await doiSoatPhiLazada(db, kenh, lz.svc, { apply: true, phieuMatGoc: true, bayGio: BAY_GIO })
        const theoId = new Map(capNhat.map(x => [x.id, x]))
        ca('H6 APPLY: ghi đúng 3 đơn có số khác (a, b, c), đúng số; d giống, e huỷ, f chưa có, g thiếu dòng, đơn kênh khác: KHÔNG đụng',
            ghi.daGhi === 3 && capNhat.length === 3 && [...theoId.keys()].sort().join() === 'a,b,c'
            && theoId.get('a').platformFee === DON_A.phi && theoId.get('a').netRevenue === DON_A.thuc
            && theoId.get('c').netRevenue === DON_C_TRA.thucSauTra && Object.keys(theoId.get('a')).sort().join() === 'id,netRevenue,platformFee',
            JSON.stringify(capNhat))
        ca('H7 vuaCoPhi chỉ đơn đi từ 0/0 lên có số (a, b) — đơn c sửa số vì trả hàng không báo "lãi thấp" lại',
            ghi.vuaCoPhi.slice().sort().join() === 'a,b', JSON.stringify(ghi.vuaCoPhi))
        const p = ghiPhiSan[0]
        ca('H8 phiếu mất gốc ⇒ PhiSanDon qua SQL_GHI_LAY_DUOC: mã LZD-…, sàn lazada, đúng kênh, đúng số; phiếu chưa có dòng thì để yên',
            ghiPhiSan.length === 1 && p.sql === SQL_GHI_LAY_DUOC && JSON.stringify(p.ma) === JSON.stringify([`LZD-${DON_P1.ma}`])
            && p.san[0] === 'lazada' && p.kenh[0] === 'kenh-lz' && p.phi[0] === DON_P1.phi && p.thuc[0] === DON_P1.thuc
            && ghi.phieuMatGoc?.daGhi === 1 && ghi.phieuMatGoc?.chuaCo === 1 && phiSanDon.get(`LZD-${DON_P2.ma}`)?.thuc === 2,
            JSON.stringify({ p, pm: ghi.phieuMatGoc }))

        const lai = await doiSoatPhiLazada(db, kenh, lz.svc, { apply: true, phieuMatGoc: true, bayGio: BAY_GIO })
        ca('H9 chạy lại HỘI TỤ: 0 đơn ghi, 0 dòng PhiSanDon mới, 4 đơn giống',
            lai.seGhi === 0 && lai.daGhi === 0 && capNhat.length === 3 && ghiPhiSan.length === 1 && lai.giongNhau === 4
            && lai.phieuMatGoc?.giongNhau === 1 && lai.vuaCoPhi.length === 0, JSON.stringify({ ...lai, mau: undefined }))

        // cron: chỉ đơn tạo từ mốc — khoảng đọc bắt đầu từ đơn cũ nhất TRONG mốc
        const lz2 = taoLazadaGia(dongLazada)
        const moc = await doiSoatPhiLazada(db, kenh, lz2.svc, { apply: false, tuNgayTao: new Date('2026-09-01T00:00:00Z'), bayGio: BAY_GIO })
        ca('H10 tuNgayTao (cron 90 ngày): chỉ soát đơn tạo từ mốc (b, d, f), đọc một khoảng 08-31 → 11-14, không soát phiếu mất gốc',
            moc.quet === 3 && JSON.stringify(lz2.goi) === JSON.stringify([{ tu: '2026-08-31', den: '2026-11-14' }]) && moc.phieuMatGoc === null,
            JSON.stringify({ quet: moc.quet, goi: lz2.goi }))

        // đọc chưa hết ⇒ không ghi đơn nào, kể cả khi apply
        const don2 = taoDon()
        const gia2 = taoDbGia(don2, taoPhieu(), new Map())
        const lzCat = taoLazadaGia(dongLazada, k => k.tu === '2026-09-21')
        const cat = await doiSoatPhiLazada(gia2.db, kenh, lzCat.svc, { apply: true, phieuMatGoc: true, bayGio: BAY_GIO })
        ca('H11 một khoảng đọc chưa hết (catTai) ⇒ KHÔNG ghi đơn / PhiSanDon nào, báo lỗi rõ',
            !!cat.loi && /chưa hết/.test(cat.loi) && gia2.capNhat.length === 0 && gia2.ghiPhiSan.length === 0 && cat.daGhi === 0, JSON.stringify({ loi: cat.loi }))

        // Lazada ném lỗi ⇒ ném tiếp, chưa ghi gì
        const gia3 = taoDbGia(taoDon(), taoPhieu(), new Map())
        let loi3 = ''
        try {
            await doiSoatPhiLazada(gia3.db, kenh, { docGiaoDichTaiChinh: async () => { throw new Error('Lazada từ chối kênh: [IllegalAccessToken] expired') } }, { apply: true, phieuMatGoc: true, bayGio: BAY_GIO })
        } catch (e: any) { loi3 = String(e?.message || e) }
        ca('H12 Lazada từ chối ⇒ NÉM nguyên văn, không ghi gì', /IllegalAccessToken/.test(loi3) && gia3.capNhat.length === 0 && gia3.ghiPhiSan.length === 0, loi3)

        // không có gì để soát ⇒ không gọi Lazada
        const gia4 = taoDbGia([donKengi('z', '1', '2026-10-03T03:00:00Z', 'cancelled', 0, 0)], [], new Map())
        const lz4 = taoLazadaGia(dongLazada)
        const rong = await doiSoatPhiLazada(gia4.db, kenh, lz4.svc, { apply: true, phieuMatGoc: true, bayGio: BAY_GIO })
        ca('H13 kênh chỉ có đơn huỷ, không phiếu mất gốc ⇒ KHÔNG gọi Lazada, khoảng null', lz4.goi.length === 0 && rong.khoang === null && rong.quet === 0)
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
