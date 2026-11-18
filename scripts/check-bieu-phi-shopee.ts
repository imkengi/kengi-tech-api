/* Kiểm chứng PHÍ SHOPEE THEO CÔNG THỨC (18/11/2026) — npx tsx scripts/check-bieu-phi-shopee.ts
 *
 * Chủ shop: "ủa phí cố định nó sẽ theo tuỳ mã hàng chứ" → "Ok, đổi đi rồi deploy". Đo prod cùng ngày: escrow Shopee khớp TỪNG
 * ĐỒNG với % ngành × Q + 6% × (Q + ship khách trả) + min(5,5% × Q, 50.000) + 3.000 + 1,5% thuế + 2.700đ (+ voucher shop, phí
 * nạp quảng cáo, affiliate). Canh:
 *  A. lib/giaShopee: phí có TRẦN (MauPhi.tran) — đánh giá lãi và giá đạt biên đúng hai bên trần; trần hỏng ⇒ bỏ qua (thận trọng).
 *  B. lib/bieuPhiShopee.uocLuongBieuPhi: dựng lại đúng biểu phí từ đơn mẫu giả lập; cờ lệch; thiếu loại phí ⇒ KHÔNG hợp lệ; phí
 *     dịch vụ khác mặc định ⇒ dò lại được; ít mẫu ⇒ không hợp lệ; đơn trả hàng bị bỏ; đẳng thức escrow khớp từng đồng.
 *  C. mauPhiCongThuc: phí của MauPhi = công thức Shopee ở mọi mức giá (kể cả trên trần); rào đủ tin của phí công thức.
 *  D. shopeeTuQuan.docMauPhiTheoNganh: gian Shopee có biểu phí ⇒ phí ngành theo công thức; cũ / hỏng / không phải Shopee / chưa có
 *     bảng ⇒ phí đo từ sổ như cũ, không ném; affiliate tách riêng, sàn theo mức cao nhất; nhãn + câu nguồn trên giao diện.
 *  E. Đo + lưu: chọn đơn mẫu, đọc escrow tuần tự, lỗi ném thì không lưu nửa vời, lưu nguyên tử theo gian, cổng đo nền.
 *  F. Soát nguồn: không ghi log mã đơn; mọi câu đọc ShopeePilotConfig lọc theo id; module chỉ ĐỌC Shopee.
 */
import fs from 'fs'
import path from 'path'
import { tinhGiaDeXuat, danhGiaGia, lyDoPhiChuaDuTin, phiDuTinChoMay, SO_DON_TU_GHI, type MauPhi } from '../src/lib/giaShopee'
import {
    uocLuongBieuPhi, docMauEscrow, mauPhiCongThuc, phiCongThucCuaDon, phiNganhTrungBinh, chonDonMau, doBieuPhi, luuBieuPhi, docBieuPhi,
    doVaLuuBieuPhi, kichDoBieuPhiNen, doBieuPhiGianCuNhat, xoaTrangThaiDoBieuPhi, bieuPhiDungDuoc, chuanHoaBieuPhi, PHI_DICH_VU_MAC_DINH,
    TUOI_BO, TUOI_DO_LAI, type BieuPhi,
} from '../src/lib/bieuPhiShopee'
import { docMauPhiTheoNganh, xoaDemPhiTheoNganh, tomTatMauPhi, cauNguonPhi } from '../src/lib/shopeeTuQuan'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (ok) dat++; else loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const gan = (a: number, b: number, sai: number) => Math.abs(a - b) <= sai

/* ── Đơn giả lập đúng biểu phí Shopee đo 18/11/2026 ─────────────────────────────────────────────────────────────────────── */
interface TuyChonDon { voucher?: number; S?: number; aff?: number; khac?: number; sl?: number; them?: number; dv?: { tyLe: number; moiDon: number; tran: number }; hoan?: number }
function escrowGia(r: number, osp: number, o: TuyChonDon = {}): any {
    const Q = osp - (o.voucher || 0), S = o.S || 0
    const dv = o.dv || PHI_DICH_VU_MAC_DINH
    const commission = Math.round(r * Q)
    const tt = Math.round(0.06 * (Q + S))
    const phan = Math.round(dv.tyLe * Q)
    const service = (dv.tran > 0 ? Math.min(phan, dv.tran) : phan) + dv.moiDon
    const vat = Math.round(0.01 * osp), pit = Math.round(0.005 * osp)
    const ads = Math.round((o.khac || 0) * osp)
    const ams = o.aff || 0
    const tong = (osp - Q) + commission + tt + service + vat + pit + 2700 + ads + ams + (o.them || 0)
    return {
        order_selling_price: osp, order_discounted_price: Q, buyer_paid_shipping_fee: S,
        commission_fee: commission, seller_transaction_fee: tt, credit_card_transaction_fee: tt, service_fee: service,
        withholding_vat_tax: vat, withholding_pit_tax: pit, shipping_seller_protection_fee_amount: 2700,
        ads_escrow_top_up_fee_or_technical_support_fee: ads, order_ams_commission_fee: ams,
        escrow_amount: osp - tong, seller_return_refund: o.hoan || 0, items: [{ quantity_purchased: o.sl || 1 }],
    }
}
const GIA = [32_000, 89_000, 150_000, 248_700, 497_999, 767_000, 1_090_000, 2_200_000]
const NGANH: Record<string, number> = { '101': 0.11, '202': 0.16, '303': 0.13, '404': 0.14 }
function mauChuan(o: TuyChonDon = {}, nganh = NGANH) {
    const ds: any[] = []
    let i = 0
    for (const [ng, r] of Object.entries(nganh)) for (const g of GIA.slice(0, 4)) { const gia = GIA[(i++) % GIA.length]!; ds.push({ ...docMauEscrow(escrowGia(r, gia + g % 7, o))!, nganh: ng }) }
    return ds
}
/** Phí Shopee chính xác (chưa làm tròn) của đơn 1 cái giá P — để so với MauPhi. */
const phiShopee = (r: number, P: number, o: { v?: number; S?: number; khac?: number } = {}) => {
    const v = o.v || 0, Q = P * (1 - v), S = o.S || 0
    return v * P + r * Q + 0.06 * (Q + S) + Math.min(0.055 * Q, 50_000) + 3000 + 0.015 * P + 2700 + (o.khac || 0) * P
}
const bieuTay = (them: Partial<BieuPhi> = {}): BieuPhi => ({
    phienBan: 1, doLuc: Date.now(), hopLe: true, soMau: 24, soKhop: 24, soBo: 0,
    thanhToan: 0.06, dichVu: { ...PHI_DICH_VU_MAC_DINH }, thue: 0.015, baoVe: 2700, khac: 0, voucher: 0, ship: 0,
    aff: { tyLeTB: 0.008, tyLeMax: 0.05, soMau: 24, soCo: 6 },
    nganh: { '101': { tyLe: 0.11, soMau: 3, min: 0.11, max: 0.11, lech: false }, '202': { tyLe: 0.16, soMau: 2, min: 0.16, max: 0.16, lech: false } },
    ...them,
})

/* ── Prisma giả cho docMauPhiTheoNganh / chọn mẫu / lưu biểu phí ──────────────────────────────────────────────────────── */
function prismaGia(o: { bang?: boolean; bieu?: Record<string, any> | null; donSo?: any[]; donNganh?: any[]; tenNganh?: any[]; mau?: any[]; kenh?: any[]; loiBieu?: boolean } = {}) {
    const st = { bang: o.bang !== false, json: o.bieu ? JSON.stringify(o.bieu) : '', cau: [] as string[], ghi: [] as { sql: string; v: any[] }[] }
    const p: any = {
        st,
        onlineChannel: { findMany: async () => o.kenh || [], findUnique: async ({ where }: any) => (o.kenh || []).find((c: any) => c.id === where.id) || null, update: async () => ({}) },
        $queryRawUnsafe: async (sql: string, ...v: any[]) => {
            st.cau.push(sql)
            if (sql.includes('to_regclass')) return [{ t: st.bang ? '"ShopeePilotConfig"' : null }]
            if (sql.includes(`FROM "ShopeePilotConfig" WHERE id = 'bieu-phi'`)) {
                if (o.loiBieu) throw new Error('Connection terminated unexpectedly')
                return st.json ? [{ schedule: st.json }] : []
            }
            if (sql.includes('ROW_NUMBER()')) return o.mau || []
            if (sql.includes('MAX("categoryName")')) return o.tenNganh || []
            if (sql.includes('HAVING COUNT(DISTINCT x.nganh) = 1')) return o.donNganh || []
            if (sql.includes('ANY($1::text[])')) return o.donSo || []
            return []
        },
        $executeRawUnsafe: async (sql: string, ...v: any[]) => {
            st.ghi.push({ sql, v })
            if (sql.includes('CREATE TABLE IF NOT EXISTS "ShopeePilotConfig"')) st.bang = true
            if (sql.includes(`INSERT INTO "ShopeePilotConfig" (id, schedule) VALUES ('bieu-phi'`)) {
                const cu = st.json ? JSON.parse(st.json) : {}
                cu[v[0]] = JSON.parse(v[1])
                st.json = JSON.stringify(cu)
            }
            return 1
        },
    }
    return p
}
/** 40 đơn đã đối soát của gian (phí từ sổ, THIẾU 2.700đ như đo thật) — để thấy phí công thức khác phí đo. */
const donSo = Array.from({ length: 40 }, (_, i) => { const g = 80_000 + i * 9_000; return { giaBan: g, phi: Math.round(0.25 * g), aff: i % 5 === 0 ? Math.round(0.03 * g) : 0 } })
const donNganh = [
    ...Array.from({ length: 12 }, (_, i) => ({ giaBan: 100_000 + i * 5000, phi: Math.round(0.24 * (100_000 + i * 5000)), aff: 0, nganh: '101' })),
    // ngành 202 đủ đơn đo từ sổ (≥ 8), một đơn affiliate 8% — cao hơn cả gian (3%) lẫn đơn mẫu (5%) ⇒ giá sàn phải theo 8%
    ...Array.from({ length: 10 }, (_, i) => ({ giaBan: 200_000 + i * 5000, phi: Math.round(0.30 * (200_000 + i * 5000)), aff: i === 0 ? Math.round(0.08 * 200_000) : 0, nganh: '202' })),
]
const tenNganh = [{ categoryId: '101', categoryName: null, viDu: 'Nồi cơm điện 1,8L', so: 12 }, { categoryId: '202', categoryName: null, viDu: 'Bình giữ nhiệt 500ml', so: 7 }, { categoryId: '909', categoryName: null, viDu: 'Quạt cầm tay', so: 4 }]
const kenhShopee = (id: string, them: any = {}) => ({ id, name: `Gian ${id}`, platform: 'shopee', commissionRate: 6, accessToken: 'tok', shopId: '123', ...them })

async function main() {
    // ─── A. Phí có trần ───────────────────────────────────────────────────────────────────────────────────────────────
    {
        const phi = { tyLe: 0.24, coDinh: 5700, tran: { tuGia: 50_000 / 0.055, giam: 0.055 } }
        const t = { giaVon: 1_000_000, phi, phiDongGoi: 0, phiQuangCaoPct: 0, phiAffiliatePct: 0, thueGtgtPct: 0 }
        const duoi = danhGiaGia(500_000, t), tren = danhGiaGia(2_000_000, t)
        dung('A1 dưới trần: phí = tyLe·P + cố định', duoi.phiSan === Math.round(0.24 * 500_000 + 5700), `${duoi.phiSan}`)
        dung('A2 trên trần: phí dịch vụ chỉ còn 50.000đ', tren.phiSan === Math.round(0.24 * 2_000_000 + 5700 - 0.055 * (2_000_000 - 50_000 / 0.055)), `${tren.phiSan}`)
        dung('A3 đúng công thức Shopee ở 2.000.000đ (11% ngành)', gan(tren.phiSan, phiShopee(0.11, 2_000_000), 1), `${tren.phiSan} vs ${phiShopee(0.11, 2_000_000)}`)
        const coTran = tinhGiaDeXuat({ giaVon: 1_500_000, phi, bienLoiNhuanPct: 20, bienToiThieuPct: 5 })
        const khongTran = tinhGiaDeXuat({ giaVon: 1_500_000, phi: { tyLe: 0.24, coDinh: 5700 }, bienLoiNhuanPct: 20, bienToiThieuPct: 5 })
        const san = danhGiaGia(coTran.giaSan, { giaVon: 1_500_000, phi }, true), duoiSan = danhGiaGia(coTran.giaSan - 200, { giaVon: 1_500_000, phi }, true)
        dung('A4 giá sàn có trần: đạt đúng biên 5% (thấp hơn 200đ là dưới biên)', coTran.hopLe && san.bienPct >= 5 && duoiSan.bienPct < 5, `${coTran.giaSan} ${san.bienPct} ${duoiSan.bienPct}`)
        dung('A5 có trần ⇒ giá sàn hàng đắt THẤP hơn khi tính như không trần', coTran.giaSan < khongTran.giaSan, `${coTran.giaSan} vs ${khongTran.giaSan}`)
        const re = tinhGiaDeXuat({ giaVon: 50_000, phi, bienLoiNhuanPct: 20, bienToiThieuPct: 5 })
        const reKhong = tinhGiaDeXuat({ giaVon: 50_000, phi: { tyLe: 0.24, coDinh: 5700 }, bienLoiNhuanPct: 20, bienToiThieuPct: 5 })
        dung('A6 hàng rẻ (dưới trần): giá như không trần', re.giaSan === reKhong.giaSan && re.giaDeXuat === reKhong.giaDeXuat)
        const hong = tinhGiaDeXuat({ giaVon: 1_500_000, phi: { tyLe: 0.24, coDinh: 5700, tran: { tuGia: 900_000, giam: 0.5 } }, bienLoiNhuanPct: 20, bienToiThieuPct: 5 })
        const nan = tinhGiaDeXuat({ giaVon: 1_500_000, phi: { tyLe: 0.24, coDinh: 5700, tran: { tuGia: NaN, giam: 0.055 } }, bienLoiNhuanPct: 20, bienToiThieuPct: 5 })
        dung('A7 trần hỏng (giảm > tỷ lệ phí / NaN) ⇒ bỏ qua trần (giá như không trần)', hong.giaSan === khongTran.giaSan && nan.giaSan === khongTran.giaSan)
    }

    // ─── B. Ước lượng biểu phí ───────────────────────────────────────────────────────────────────────────────────────
    {
        const mau = mauChuan({ S: 0 })
        const b = uocLuongBieuPhi(mau)
        dung('B1 hợp lệ, % từng ngành đúng', b.hopLe && Object.entries(NGANH).every(([k, r]) => b.nganh[k] && gan(b.nganh[k]!.tyLe, r, 1e-9)), JSON.stringify(b.nganh))
        dung('B2 khoản chung: thanh toán 6%, thuế 1,5%, dịch vụ mặc định, bảo vệ 2.700đ', b.thanhToan === 0.06 && b.thue === 0.015 && b.dichVu.tyLe === 0.055 && b.dichVu.moiDon === 3000 && b.dichVu.tran === 50_000 && b.baoVe === 2700,
            JSON.stringify({ tt: b.thanhToan, thue: b.thue, dv: b.dichVu, bv: b.baoVe }))
        dung('B3 mọi đơn mẫu khớp phí thật', b.soKhop === mau.length && b.soMau === mau.length, `${b.soKhop}/${b.soMau}`)
        const lech = uocLuongBieuPhi([...mau, { ...docMauEscrow(escrowGia(0.12, 300_000))!, nganh: '101' }])
        dung('B4 đơn cùng ngành ra % khác ⇒ cờ lệch, lấy mức CAO nhất', lech.nganh['101']!.lech && lech.nganh['101']!.tyLe === 0.12 && !lech.nganh['202']!.lech, JSON.stringify(lech.nganh['101']))
        const thieu = uocLuongBieuPhi(mauChuan({ them: 9000 }))
        dung('B5 có loại phí ngoài công thức (9.000đ mỗi đơn) ⇒ KHÔNG hợp lệ, có lý do', !thieu.hopLe && /khớp phí thật/.test(thieu.lyDo || ''), thieu.lyDo)
        const dv6 = { tyLe: 0.06, moiDon: 2000, tran: 40_000 }
        const khac = uocLuongBieuPhi(mauChuan({ dv: dv6 }))
        dung('B6 phí dịch vụ đổi (6% + 2.000đ, trần 40.000đ) ⇒ dò lại được, vẫn hợp lệ', khac.hopLe && khac.dichVu.tyLe === 0.06 && khac.dichVu.moiDon === 2000 && khac.dichVu.tran === 40_000, JSON.stringify(khac.dichVu) + ' ' + khac.lyDo)
        const it = uocLuongBieuPhi(mau.slice(0, 4))
        dung('B7 dưới 5 đơn mẫu ⇒ chưa lập biểu phí', !it.hopLe && /cần ít nhất 5/.test(it.lyDo || ''), it.lyDo)
        dung('B8 đơn trả hàng / hoàn tiền bị bỏ', docMauEscrow(escrowGia(0.11, 200_000, { hoan: -200_000 })) === null && docMauEscrow({ order_selling_price: 0, order_discounted_price: 0, escrow_amount: -2700 }) === null)
        const inc = escrowGia(0.16, 767_000, { voucher: 10_000, S: 15_000, aff: 23_000, khac: 0.0108 })
        const m = docMauEscrow(inc)!
        dung('B9 đẳng thức escrow: phí công thức = osp − escrow (credit_card_transaction_fee KHÔNG cộng đôi)',
            gan(phiCongThucCuaDon({ thanhToan: 0.06, dichVu: PHI_DICH_VU_MAC_DINH, thue: 0.015 }, 0.16, m), m.phi, 2), `${phiCongThucCuaDon({ thanhToan: 0.06, dichVu: PHI_DICH_VU_MAC_DINH, thue: 0.015 }, 0.16, m)} vs ${m.phi}`)
        const coShip = uocLuongBieuPhi(mauChuan({ S: 20_000, voucher: 5000, khac: 0.0108 }))
        dung('B10 ship khách trả / voucher / phí nạp quảng cáo: vẫn khớp, đo đúng trung bình', coShip.hopLe && coShip.ship === 20_000 && coShip.khac === 0.0108 && coShip.voucher > 0,
            JSON.stringify({ hl: coShip.hopLe, ship: coShip.ship, khac: coShip.khac, v: coShip.voucher, lyDo: coShip.lyDo }))
        const chuan = chuanHoaBieuPhi(JSON.parse(JSON.stringify(b)))
        dung('B11 lưu JSON rồi đọc lại ra cùng biểu phí; JSON hỏng ⇒ null', !!chuan && chuan.hopLe && chuan.nganh['202']!.tyLe === 0.16 && chuanHoaBieuPhi({ phienBan: 2 }) === null && chuanHoaBieuPhi('x') === null)
        const voLy = chuanHoaBieuPhi({ ...JSON.parse(JSON.stringify(b)), thanhToan: 0.9 })
        dung('B12 số vô lý trong JSON (thanh toán 90%) ⇒ không hợp lệ', !!voLy && !voLy.hopLe)
    }

    // ─── C. MauPhi theo công thức + rào đủ tin ─────────────────────────────────────────────────────────────────────────
    {
        const b = bieuTay()
        const m = mauPhiCongThuc(b, 0.11, { soMauNganh: 3 })
        const t = (P: number) => danhGiaGia(P, { giaVon: 1, phi: m }, true).phiSan   // quaAffiliate: không cộng affiliate TB
        const lech = [20_000, 99_000, 450_000, 909_000, 909_100, 1_500_000, 5_000_000].map(P => Math.abs(t(P) - phiShopee(0.11, P)))
        dung('C1 phí MauPhi = công thức Shopee ở mọi giá (cả trên trần 50.000đ)', lech.every(x => x <= 1), lech.join(','))
        const b2 = bieuTay({ voucher: 0.02, ship: 18_000, khac: 0.0108 })
        const m2 = mauPhiCongThuc(b2, 0.16, { soMauNganh: 2 })
        const t2 = (P: number) => danhGiaGia(P, { giaVon: 1, phi: m2 }, true).phiSan
        const lech2 = [50_000, 300_000, 1_200_000].map(P => Math.abs(t2(P) - phiShopee(0.16, P, { v: 0.02, S: 18_000, khac: 0.0108 })))
        dung('C2 có voucher shop TB / ship khách trả TB / phí nạp quảng cáo: vẫn đúng công thức', lech2.every(x => x <= 1), lech2.join(','))
        dung('C3 đủ tin: ngành có mẫu, không lệch, gian ≥ 10 đơn khớp ⇒ máy được tự hạ — kể cả giá rất thấp', lyDoPhiChuaDuTin(15_000, m) === null && phiDuTinChoMay(m))
        const mLech = mauPhiCongThuc(b, 0.12, { soMauNganh: 2, lech: true })
        const mIt = mauPhiCongThuc(bieuTay({ soMau: 9, soKhop: 9 }), 0.11, { soMauNganh: 3 })
        const mThay = { ...mauPhiCongThuc(b, 0.13, { soMauNganh: 0 }), thayNganh: 'Quạt (909)' }
        const mRo = { ...mauPhiCongThuc(b, 0.13, { soMauNganh: 0 }), chuaRoNganh: true }
        dung('C4 lệch ⇒ chưa tin', /khác nhau/.test(lyDoPhiChuaDuTin(500_000, mLech) || '') && !phiDuTinChoMay(mLech))
        dung('C5 gian mới khớp 9 đơn ⇒ chưa tin', /9\/10/.test(lyDoPhiChuaDuTin(500_000, mIt) || '') && !phiDuTinChoMay(mIt), lyDoPhiChuaDuTin(500_000, mIt) || '')
        dung('C6 ngành chưa có mẫu / chưa rõ ngành ⇒ chưa tin', /chưa có đơn đã hoàn tất/.test(lyDoPhiChuaDuTin(500_000, mThay) || '') && /chưa rõ ngành/.test(lyDoPhiChuaDuTin(500_000, mRo) || '') && !phiDuTinChoMay(mThay))
        const cu: MauPhi = { tyLe: 0.25, coDinh: 0, nguon: 'hoi-quy-don', soDon: SO_DON_TU_GHI, ghiChu: '' }
        dung('C7 phí đo từ sổ giữ rào cũ (30 đơn)', phiDuTinChoMay(cu) && !phiDuTinChoMay({ ...cu, soDon: SO_DON_TU_GHI - 1 }) && !phiDuTinChoMay({ ...cu, nguon: 'cau-hinh-kenh', khai: true }))
        dung('C8 % trung bình các ngành theo số đơn', gan(phiNganhTrungBinh(b, new Map([['101', 30], ['202', 10]])), 0.1225, 1e-9), String(phiNganhTrungBinh(b, new Map([['101', 30], ['202', 10]]))))
    }

    // ─── D. docMauPhiTheoNganh ───────────────────────────────────────────────────────────────────────────────────────
    {
        delete process.env.BIEU_PHI_DO_NEN
        delete process.env.K_SERVICE
        xoaDemPhiTheoNganh()
        const b = bieuTay()
        const p = prismaGia({ bieu: { ch1: b }, donSo, donNganh, tenNganh })
        const bang = await docMauPhiTheoNganh(p, kenhShopee('ch1'))
        const n1 = bang.chon('101'), n9 = bang.chon('909'), n0 = bang.chon(null)
        dung('D1 ngành có mẫu ⇒ phí công thức của ngành', n1.nguon === 'cong-thuc' && n1.nganh === '101' && gan(n1.tyLe, 0.11 + 0.06 + 0.055 + 0.015, 1e-9) && n1.coDinh === 5700, JSON.stringify({ n: n1.nguon, t: n1.tyLe, c: n1.coDinh }))
        dung('D2 ngành chưa có mẫu ⇒ % trung bình, gắn thayNganh; chưa rõ ngành ⇒ chuaRoNganh', n9.nguon === 'cong-thuc' && !!n9.thayNganh && !!n0.chuaRoNganh && !phiDuTinChoMay(n9) && !phiDuTinChoMay(n0))
        dung('D3 affiliate tách riêng; sàn theo mức CAO nhất cả gian / ngành / mẫu', !!n1.affiliate?.tachRieng && gan(n1.affiliate!.tyLeMax, 0.08, 1e-9), JSON.stringify(n1.affiliate))
        const gTong = tinhGiaDeXuat({ giaVon: 300_000, phi: n1, bienLoiNhuanPct: 20, bienToiThieuPct: 5 })
        const sanAff = danhGiaGia(gTong.giaSan, { giaVon: 300_000, phi: n1 }, true)
        dung('D4 giá sàn theo phí công thức: đơn affiliate 8% vẫn đạt biên 5%', gTong.hopLe && sanAff.bienPct >= 5, `${gTong.giaSan} ${sanAff.bienPct}`)
        const tt = tomTatMauPhi(n1, bang), tt9 = tomTatMauPhi(n9, bang)
        dung('D5 tóm tắt cho giao diện: ngành tin được, câu nguồn nói biểu phí + % ngành', tt.trusted === true && tt.scope === 'nganh' && /Biểu phí Shopee/.test(tt.detail) && /11%/.test(tt.detail) && !('autoLabel' in tt), tt.detail)
        dung('D6 ngành chưa có mẫu: không tin, nhãn nói rõ lý do', tt9.trusted === false && /chưa có đơn mẫu/.test((tt9 as any).autoLabel || '') && /chưa có đơn đã hoàn tất/.test(cauNguonPhi(n9, bang)), (tt9 as any).autoLabel)
        dung('D7 bảng ngành = các ngành có mẫu', [...bang.theoNganh.keys()].sort().join(',') === '101,202')

        xoaDemPhiTheoNganh()
        const cu = await docMauPhiTheoNganh(prismaGia({ bieu: { ch1: bieuTay({ doLuc: Date.now() - TUOI_BO - 60_000 }) }, donSo, donNganh, tenNganh }), kenhShopee('ch1'))
        dung('D8 biểu phí quá 7 ngày ⇒ phí đo từ sổ như cũ', cu.chon('101').nguon !== 'cong-thuc' && cu.toanGian.nguon !== 'cong-thuc', cu.chon('101').nguon)
        xoaDemPhiTheoNganh()
        const hong = await docMauPhiTheoNganh(prismaGia({ bieu: { ch1: { ...bieuTay(), hopLe: false, lyDo: 'x' } }, donSo, donNganh, tenNganh }), kenhShopee('ch1'))
        dung('D9 biểu phí không hợp lệ ⇒ phí đo từ sổ', hong.chon('101').nguon !== 'cong-thuc')
        xoaDemPhiTheoNganh()
        const tk = await docMauPhiTheoNganh(prismaGia({ bieu: { ch1: b }, donSo, donNganh, tenNganh }), kenhShopee('ch1', { platform: 'tiktok' }))
        dung('D10 gian TikTok có dòng biểu phí ⇒ KHÔNG dùng công thức Shopee', tk.chon('101').nguon !== 'cong-thuc')
        xoaDemPhiTheoNganh()
        const pKhong = prismaGia({ bang: false, bieu: { ch1: b }, donSo, donNganh, tenNganh })
        const khong = await docMauPhiTheoNganh(pKhong, kenhShopee('ch1'))
        dung('D11 chưa có bảng Pilot ⇒ phí đo từ sổ, không chạm bảng (chỉ dò to_regclass)',
            khong.chon('101').nguon !== 'cong-thuc' && !pKhong.st.cau.some((s: string) => s.includes('FROM "ShopeePilotConfig"')))
        xoaDemPhiTheoNganh()
        let nem = ''
        try { await docMauPhiTheoNganh(prismaGia({ bieu: { ch1: b }, loiBieu: true, donSo, donNganh, tenNganh }), kenhShopee('ch1')) } catch (e: any) { nem = String(e?.message || e) }
        dung('D12 đọc biểu phí hỏng ⇒ không ném, dùng phí đo từ sổ', nem === '', nem)
        xoaDemPhiTheoNganh()
        const pNen = prismaGia({ bieu: { ch1: bieuTay({ doLuc: Date.now() - TUOI_DO_LAI - 60_000 }) }, donSo, donNganh, tenNganh })
        const nen = await docMauPhiTheoNganh(pNen, kenhShopee('ch1'))
        dung('D13 biểu phí > 24 giờ nhưng ≤ 7 ngày: vẫn dùng; bộ kiểm (không K_SERVICE) KHÔNG đo nền', nen.chon('101').nguon === 'cong-thuc' && !pNen.st.cau.some((s: string) => s.includes('ROW_NUMBER()')))
    }

    // ─── E. Chọn mẫu, đo, lưu ───────────────────────────────────────────────────────────────────────────────────────
    {
        const p = prismaGia({ mau: [{ sn: 'SPE-AAA', nganh: '101' }, { sn: 'BBB', nganh: ' 202 ' }, { sn: '', nganh: '303' }, { sn: 'CCC', nganh: null }] })
        const ds = await chonDonMau(p, 'ch1')
        dung('E1 chọn mẫu: bỏ tiền tố SPE-, bỏ dòng thiếu mã / ngành', ds.length === 2 && ds[0]!.sn === 'AAA' && ds[1]!.nganh === '202', JSON.stringify(ds))
        const cauMau = p.st.cau.find((s: string) => s.includes('ROW_NUMBER()')) || ''
        dung('E2 câu chọn mẫu: chỉ đơn COMPLETED 90 ngày, MỘT ngành, xếp theo lượt', /'COMPLETED'/.test(cauMau) && /90 days/.test(cauMau) && /COUNT\(DISTINCT x\.nganh\) = 1/.test(cauMau) && /ORDER BY hang, nganh/.test(cauMau))

        const thu: string[] = []
        const nguon: Record<string, any> = {}
        const mauDon: any[] = []
        let i = 0
        for (const [ng, r] of Object.entries(NGANH)) for (const g of GIA.slice(0, 3)) { const sn = `S${i++}`; nguon[sn] = escrowGia(r, g); mauDon.push({ sn, nganh: ng }) }
        mauDon.push({ sn: 'MAT', nganh: '101' })
        const p2 = prismaGia({ mau: mauDon })
        const b = await doBieuPhi(p2, 'ch1', async sn => { thu.push(sn); return nguon[sn] ?? null })
        dung('E3 đọc escrow từng đơn đúng thứ tự, đơn không thấy thì bỏ (đếm soBo)', thu.length === mauDon.length && thu[0] === 'S0' && b.hopLe && b.soBo === 1 && b.soMau === mauDon.length - 1, `${thu.length} ${b.hopLe} ${b.soBo} ${b.lyDo || ''}`)

        xoaTrangThaiDoBieuPhi()
        const p3 = prismaGia({ bang: false, mau: mauDon })
        const ch = kenhShopee('ch3')
        const svcGia = { apiUrl: (x: string) => `https://gia${x}?a=1`, httpGet: async (url: string) => { const sn = /order_sn=([^&]+)/.exec(url)?.[1] || ''; return { response: { order_income: nguon[decodeURIComponent(sn)] ?? null } } } }
        const kq = await doVaLuuBieuPhi(p3, ch, async () => svcGia)
        const docLai = await docBieuPhi(prismaGia({ bieu: JSON.parse(p3.st.json || '{}') }), 'ch3')
        dung('E4 đo + lưu: tạo đúng bảng cấu hình Pilot, ghi theo gian, đọc lại được', !!kq.bieu?.hopLe && !kq.loi && p3.st.ghi.some((g: any) => /CREATE TABLE IF NOT EXISTS "ShopeePilotConfig"/.test(g.sql))
            && !p3.st.ghi.some((g: any) => /"ShopeePilotPlan"|"ShopeePilotWrite"/.test(g.sql)) && !!docLai?.hopLe && docLai!.nganh['202']!.tyLe === 0.16, kq.loi)
        const p4 = prismaGia({ mau: mauDon, bieu: { khac: { giu: 1 } } })
        xoaTrangThaiDoBieuPhi()
        const svcHong = { apiUrl: (x: string) => x + '?', httpGet: async () => ({ error: 'error_auth', message: 'Invalid access_token' }) }
        const kq4 = await doVaLuuBieuPhi(p4, kenhShopee('ch4'), async () => svcHong)
        dung('E5 Shopee từ chối (token) ⇒ trả lỗi, KHÔNG lưu biểu phí nửa vời', !kq4.bieu && /error_auth/.test(kq4.loi || '') && !p4.st.ghi.some((g: any) => /INSERT INTO "ShopeePilotConfig"/.test(g.sql)), kq4.loi)
        const kq5 = await doVaLuuBieuPhi(p4, kenhShopee('ch5'), async () => ({ loiLamMoiToken: 'refresh hỏng' }))
        dung('E6 token gian hỏng ⇒ không hỏi Shopee', !kq5.bieu && /token gian hỏng/.test(kq5.loi || ''))
        const svcMang = { apiUrl: (x: string) => x + '?', httpGet: async (url: string) => { throw new Error(`request to https://proxy${url}&access_token=TOKBIMAT&sign=KYBIMAT failed, reason: ECONNRESET`) } }
        const kq5b = await doVaLuuBieuPhi(prismaGia({ mau: [{ sn: 'MADONBIMAT', nganh: '101' }] }), kenhShopee('ch5b'), async () => svcMang)
        dung('E6b lỗi mạng kèm URL đã ký ⇒ che token / chữ ký / mã đơn trước khi ghi log', !!kq5b.loi && /ECONNRESET/.test(kq5b.loi) && !/TOKBIMAT|KYBIMAT|MADONBIMAT/.test(kq5b.loi), kq5b.loi)
        const p6 = prismaGia({ mau: mauDon, bieu: { khac: { giu: 1 } } })
        xoaTrangThaiDoBieuPhi()
        await doVaLuuBieuPhi(p6, kenhShopee('ch6'), async () => svcGia)
        const j6 = JSON.parse(p6.st.json)
        dung('E7 lưu một gian không đè biểu phí gian khác', j6.khac?.giu === 1 && j6.ch6?.hopLe === true)

        xoaTrangThaiDoBieuPhi()
        delete process.env.BIEU_PHI_DO_NEN; delete process.env.K_SERVICE
        dung('E8 cổng đo nền: không K_SERVICE / BIEU_PHI_DO_NEN ⇒ không đo', kichDoBieuPhiNen(prismaGia(), kenhShopee('n1'), null, async () => svcGia) === false
            && (await doBieuPhiGianCuNhat(prismaGia({ kenh: [kenhShopee('n1')] }), async () => svcGia)) === 'tat')
        process.env.BIEU_PHI_DO_NEN = '1'
        const moi = bieuTay()
        dung('E9 biểu phí còn mới ⇒ không đo; thiếu token / không phải Shopee ⇒ không đo',
            !kichDoBieuPhiNen(prismaGia(), kenhShopee('n2'), moi, async () => svcGia) && !kichDoBieuPhiNen(prismaGia(), kenhShopee('n3', { accessToken: null }), null, async () => svcGia)
            && !kichDoBieuPhiNen(prismaGia(), kenhShopee('n4', { platform: 'lazada' }), null, async () => svcGia))
        const p7 = prismaGia({ mau: mauDon })
        const lan1 = kichDoBieuPhiNen(p7, kenhShopee('n5'), bieuTay({ doLuc: Date.now() - TUOI_DO_LAI - 1 }), async () => svcGia)
        const lan2 = kichDoBieuPhiNen(p7, kenhShopee('n5'), null, async () => svcGia)
        dung('E10 cũ > 24 giờ ⇒ kích đo nền MỘT lần (lượt sau đang chạy / vừa thử thì thôi)', lan1 && !lan2)
        xoaTrangThaiDoBieuPhi()
        const p8 = prismaGia({ mau: mauDon, kenh: [kenhShopee('k1'), kenhShopee('k2'), kenhShopee('k3', { accessToken: null })], bieu: { k1: bieuTay(), k2: bieuTay({ doLuc: Date.now() - 3 * 86400_000 }) } })
        const r8 = await doBieuPhiGianCuNhat(p8, async () => svcGia)
        dung('E11 lượt Pilot theo lịch đo đúng gian có biểu phí cũ nhất (bỏ gian chưa uỷ quyền)', /^Gian k2: hợp lệ/.test(r8) && JSON.parse(p8.st.json).k2.doLuc > Date.now() - 60_000, r8)
        delete process.env.BIEU_PHI_DO_NEN
        await new Promise(r => setTimeout(r, 50))   // để lượt đo nền E10 xong trước khi in kết quả
        dung('E12 biểu phí dùng được: hợp lệ + ≤ 7 ngày', bieuPhiDungDuoc(moi) && !bieuPhiDungDuoc({ ...moi, hopLe: false }) && !bieuPhiDungDuoc({ ...moi, doLuc: Date.now() - TUOI_BO - 1 }) && !bieuPhiDungDuoc(null))
    }

    // ─── F. Soát nguồn ──────────────────────────────────────────────────────────────────────────────────────────────
    {
        const GOC = path.resolve(__dirname, '..')
        const nguon = fs.readFileSync(path.join(GOC, 'src/lib/bieuPhiShopee.ts'), 'utf8')
        const dongLog = nguon.split('\n').filter(l => /console\.(log|warn|error)/.test(l))
        dung('F1 không ghi log mã đơn (biến sn / order_sn)', dongLog.length > 0 && dongLog.every(l => !/\bsn\b|order_sn|x\.sn/.test(l)), dongLog.join(' | '))
        // mọi tệp trong src (trừ client sinh tự động) có chạm bảng — tệp mới đọc bảng mà quên lọc id cũng bị bắt
        const tep: string[] = []
        const duyet = (thu: string) => {
            for (const e of fs.readdirSync(path.join(GOC, thu), { withFileTypes: true })) {
                const r = `${thu}/${e.name}`
                if (e.isDirectory()) { if (e.name !== 'generated' && e.name !== 'node_modules') duyet(r) }
                else if (/\.ts$/.test(e.name) && fs.readFileSync(path.join(GOC, r), 'utf8').includes('"ShopeePilotConfig"')) tep.push(r)
            }
        }
        duyet('src')
        const sai: string[] = tep.length >= 3 ? [] : [`chỉ thấy ${tep.length} tệp chạm bảng — bộ dò hỏng?`]
        for (const t of tep) {
            const s = fs.readFileSync(path.join(GOC, t), 'utf8')
            const re = /(FROM|UPDATE)\s+"ShopeePilotConfig"([^`]*)/g
            let m: RegExpExecArray | null
            while ((m = re.exec(s))) if (!/WHERE id = /.test(m[2]!.slice(0, 160))) sai.push(`${t}: ${m[0].slice(0, 90)}`)
        }
        dung('F2 mọi câu đọc / sửa ShopeePilotConfig đều lọc theo id (dòng "bieu-phi" không lẫn vào cấu hình)', !sai.length, sai.join(' | '))
        dung('F3 module biểu phí chỉ ĐỌC Shopee (get_escrow_detail, không httpPost)', /get_escrow_detail/.test(nguon) && !/httpPost|\/add_|\/update_|\/delete_/.test(nguon))
    }

    console.log(`\n${dat}/${dat + loi} ca đạt`)
    if (loi) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
