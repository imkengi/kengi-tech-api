/* ═══════════════════════════════════════════════════════════════════════════════
 *  BIỂU PHÍ SHOPEE ĐỌC THẲNG TỪ ESCROW — phí sàn tính theo CÔNG THỨC (18/11/2026)
 *
 *  Chủ shop: "ủa phí cố định nó sẽ theo tuỳ mã hàng chứ" → "Ok, đổi đi rồi deploy".
 *
 *  Đo prod 18/11/2026 (chỉ đọc; 49 đơn một mã của 7 ngành / 28 mã + 16 đơn ngẫu nhiên — KHỚP TỪNG ĐỒNG):
 *    osp − escrow_amount = (osp − Q)                       voucher shop / giảm combo (Q = order_discounted_price)
 *                        + commission_fee                  = % NGÀNH × Q — số nguyên %, MỌI mã cùng ngành cùng mức
 *                        + seller_transaction_fee          = 6% × (Q + buyer_paid_shipping_fee)
 *                        + service_fee                     = Σ min(5,5% × giá 1 CÁI, 50.000) × SL + 3.000
 *                        + withholding_vat_tax + withholding_pit_tax   = 1,5% × Q
 *                        + shipping_seller_protection_fee_amount       = 2.700đ/đơn — CHỈ khi đơn ĐÃ GỬI (đơn chưa gửi = 0)
 *                        + ads_escrow_top_up_fee_or_technical_support_fee (chỉ Kengi Tools: 1,08% × osp)
 *                        + order_ams_commission_fee        affiliate
 *  (credit_card_transaction_fee là CÙNG khoản với seller_transaction_fee — cộng là đếm đôi.)
 *  Đo lại 21/11/2026 (chỉ đọc, 11 đơn có combo / nhiều cái): trần 50.000đ của phí dịch vụ là theo TỪNG CÁI (3 đơn 2 cái giá
 *  > 909.000đ ra 2 × 50.000 + 3.000 — theo đơn thì sai); thuế 1,5% tính trên Q (đơn combo: osp ≠ Q mới phân biệt được). Ship
 *  khách trả (buyer_paid_shipping_fee): đơn chưa hoàn tất escrow CỘNG cả khoản này (final_shipping_fee = 0), hoàn tất thì
 *  final_shipping_fee = −ship ⇒ ròng 0 — tiền ship đi cho đơn vị vận chuyển, không phải của shop.
 *
 *  Vì sao không đo từ sổ (OnlineOrder.platformFee như lib/giaShopee.uocLuongPhi): đồng bộ phí đọc escrow SỚM rồi không đọc
 *  lại — 16 đơn ngẫu nhiên: 6 thiếu đúng 2.700đ, 8 thiếu 1.884–20.358đ, 1 đã hoàn tiền mà sổ vẫn ghi phí ⇒ hồi quy trên số đó
 *  ra phí THẤP hơn thật. Và hồi quy cần ≥ 8 đơn MỖI ngành; theo công thức thì một đơn là biết % của ngành.
 *
 *  Cách làm (doBieuPhi): mỗi ngành ≤ SO_MAU_MOI_NGANH đơn COMPLETED mới nhất chỉ có hàng của ngành đó (ưu tiên đơn 1 cái)
 *  ⇒ đọc escrow từng đơn, TUẦN TỰ (proxy Tino) ⇒ uocLuongBieuPhi: % ngành = commission / Q (các đơn lệch nhau ⇒ lấy mức CAO
 *  nhất, cờ `lech`); khoản chung cả gian lấy trung vị / trung bình; phí dịch vụ thử công thức mặc định trước, không khớp mới
 *  dò lại. KIỂM: phí công thức của TỪNG đơn mẫu (với Q, ship, voucher, affiliate thật của đơn) phải khớp osp − escrow tới
 *  max(1.000đ; 0,5% giá) ở ≥ 90% mẫu. Shopee thêm loại phí mới ⇒ hỏng kiểm ⇒ biểu phí KHÔNG hợp lệ ⇒ Pilot quay về phí đo
 *  từ sổ như cũ (không bao giờ tính giá theo một công thức đã sai).
 *
 *  Lưu (luuBieuPhi): dòng id 'bieu-phi' của bảng ShopeePilotConfig (bảng Pilot tạo lười — KHÔNG migration), cột schedule =
 *  JSON { [channelId]: BieuPhi }, ghi nguyên tử bằng jsonb_set. Mọi câu khác của bảng đều lọc id = 'default' nên dòng này
 *  không lẫn vào cấu hình. Đọc (docBieuPhi): dò to_regclass trước — bảng chưa có thì im lặng (bắt 42P01 vẫn in log Prisma).
 *  Cũ quá TUOI_DO_LAI (24 giờ) ⇒ đo lại nền (kichDoBieuPhiNen); quá TUOI_BO (7 ngày) ⇒ không dùng nữa.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import type { AffiliateDo, MauPhi } from './giaShopee'

/** Một đơn mẫu đọc từ escrow (order_income) — mọi số là VND của CẢ đơn. */
export interface MauEscrow {
    /** order_selling_price — giá bán (sau giảm giá của shop, trước voucher shop) */
    osp: number
    /** order_discounted_price — giá sau voucher shop: nền của commission / phí thanh toán / phí dịch vụ */
    Q: number
    /** buyer_paid_shipping_fee — ship khách trả (phí thanh toán tính cả phần này) */
    S: number
    hoaHong: number
    thanhToan: number
    dichVu: number
    thue: number
    baoVe: number
    khac: number
    aff: number
    /** phí thật của đơn = osp − escrow_amount */
    phi: number
    /** tổng số cái trong đơn */
    sl: number
    /** từng dòng hàng: giá CẢ dòng sau giảm (items[].discounted_price, co giãn cho Σ = Q) + số cái — phí dịch vụ có trần theo
     *  TỪNG CÁI cần giá một cái. Rỗng ⇒ phiDichVu coi cả đơn là một cái. */
    dong: DongEscrow[]
}

/** Một dòng hàng của escrow: giá CẢ dòng (sau giảm) và số cái. */
export interface DongEscrow { gia: number; sl: number }

/** items[] của order_income ⇒ giá cả dòng sau giảm (discounted_price — sau combo / giảm giá shop) co giãn cho Σ = Q, kèm số
 *  cái. Thiếu giá ⇒ [] (bên dùng coi cả đơn là một cái). */
export function dongEscrow(inc: any, Q: number): DongEscrow[] {
    const items: any[] = Array.isArray(inc?.items) ? inc.items : []
    const tho = items.map(i => ({ gia: Math.max(0, so(i?.discounted_price)), sl: Math.max(1, Math.round(so(i?.quantity_purchased)) || 1) }))
    const tong = tho.reduce((s, d) => s + d.gia, 0)
    if (!(tong > 0) || !(Q > 0)) return []
    const k = Q / tong
    return tho.map(d => ({ gia: d.gia * k, sl: d.sl }))
}

export interface BieuPhiNganh {
    /** % phí cố định của ngành (0..1) — mức CAO nhất các đơn mẫu */
    tyLe: number
    soMau: number
    min: number
    max: number
    /** các đơn mẫu ra % khác nhau quá LECH_NGANH */
    lech: boolean
}

export interface PhiDichVu {
    /** phần % trên Q (0..1) */
    tyLe: number
    /** VND mỗi đơn */
    moiDon: number
    /** trần của phần % (VND); 0 = chưa thấy trần ⇒ coi như không trần (phí cao hơn = thận trọng) */
    tran: number
}

export interface BieuPhi {
    phienBan: 1
    /** lúc đo (epoch ms) */
    doLuc: number
    hopLe: boolean
    /** vì sao không hợp lệ — câu cho người đọc */
    lyDo?: string
    /** số đơn mẫu dùng được / số đơn khớp phí thật */
    soMau: number
    soKhop: number
    /** số đơn hỏi Shopee mà đọc hỏng / bỏ (trả hàng, thiếu số) — chỉ để báo */
    soBo?: number
    thanhToan: number
    dichVu: PhiDichVu
    thue: number
    /** VND mỗi đơn (trung bình) */
    baoVe: number
    /** phí khác theo % giá (ads_escrow_top_up_fee_or_technical_support_fee), trung bình */
    khac: number
    /** phần giá trả voucher shop, trung bình (0..1) */
    voucher: number
    /** ship khách trả trung bình (VND) — phí thanh toán tính cả phần này */
    ship: number
    aff: { tyLeTB: number; tyLeMax: number; soMau: number; soCo: number }
    nganh: Record<string, BieuPhiNganh>
}

export const SO_MAU_MOI_NGANH = 3
/** Trần số đơn hỏi Shopee mỗi lần đo một gian (≈ 30–60 giây qua proxy). Xếp theo lượt nên trần cắt đơn thứ hai / ba của
 *  ngành, không cắt mất ngành (gian ≤ 60 ngành có hàng bán). */
export const TRAN_MAU_MOI_GIAN = 60
/** Dưới chừng này đơn mẫu dùng được ⇒ chưa lập biểu phí. */
export const SO_MAU_TOI_THIEU = 5
/** Hai đơn cùng ngành lệch quá 0,15 điểm % ⇒ cờ lech. */
const LECH_NGANH = 0.0015
export const TUOI_DO_LAI = 24 * 3600_000
export const TUOI_BO = 7 * 24 * 3600_000
export const PHI_DICH_VU_MAC_DINH: PhiDichVu = { tyLe: 0.055, moiDon: 3000, tran: 50_000 }

const so = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const tron = (x: number, k = 1e5) => Math.round(x * k) / k
const trungVi = (a: number[]) => {
    if (!a.length) return 0
    const s = [...a].sort((x, y) => x - y), g = Math.floor(s.length / 2)
    return s.length % 2 ? s[g]! : (s[g - 1]! + s[g]!) / 2
}
const trungBinh = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

/** order_income của get_escrow_detail ⇒ đơn mẫu; null = không dùng được (trả hàng / hoàn tiền, thiếu giá, chưa có phí). */
export function docMauEscrow(inc: any): MauEscrow | null {
    if (!inc || typeof inc !== 'object') return null
    const osp = so(inc.order_selling_price), Q = so(inc.order_discounted_price)
    const escrow = Number(inc.escrow_amount)
    if (!(osp > 0) || !(Q > 0) || Q > osp + 1 || inc.escrow_amount == null || !Number.isFinite(escrow)) return null
    // trả hàng / hoàn tiền: escrow không còn là phí của một đơn bán (đo 18/11: đơn hoàn toàn bộ chỉ còn −2.700đ)
    if (so(inc.seller_return_refund) !== 0) return null
    const hoaHong = so(inc.commission_fee)
    if (!(hoaHong > 0)) return null
    const items: any[] = Array.isArray(inc.items) ? inc.items : []
    return {
        osp, Q, S: Math.max(0, so(inc.buyer_paid_shipping_fee)),
        hoaHong, thanhToan: so(inc.seller_transaction_fee), dichVu: so(inc.service_fee),
        thue: so(inc.withholding_vat_tax) + so(inc.withholding_pit_tax),
        baoVe: so(inc.shipping_seller_protection_fee_amount),
        khac: so(inc.ads_escrow_top_up_fee_or_technical_support_fee),
        aff: Math.max(0, so(inc.order_ams_commission_fee)),
        phi: osp - escrow,
        sl: Math.max(1, items.reduce((s, i) => s + Math.max(0, so(i?.quantity_purchased)), 0)),
        dong: dongEscrow(inc, Q),
    }
}

/** Phí dịch vụ của một đơn theo biểu: phần % — trần áp cho TỪNG CÁI (đo 21/11/2026) — + phí mỗi đơn. `dong` = giá cả dòng sau
 *  giảm + số cái (Σ giá = Q); thiếu ⇒ coi cả đơn là một cái. */
export function phiDichVu(dv: PhiDichVu, Q: number, dong?: DongEscrow[]): number {
    const ds = dong && dong.length ? dong : [{ gia: Q, sl: 1 }]
    const phan = ds.reduce((s, d) => {
        const sl = Math.max(1, Math.round(d.sl) || 1), mot = dv.tyLe * (d.gia / sl)
        return s + (dv.tran > 0 ? Math.min(mot, dv.tran) : mot) * sl
    }, 0)
    return phan + dv.moiDon
}

/** Phí dịch vụ: thử biểu mặc định trước; không khớp ≥ 90% mẫu thì dò lại %, phí/đơn (và trần nếu thấy) từ chính mẫu. */
function doPhiDichVu(mau: MauEscrow[]): PhiDichVu | null {
    // làm tròn từng dòng hàng ⇒ cho lệch vài đồng theo số cái
    const khop = (dv: PhiDichVu) => mau.filter(m => Math.abs(m.dichVu - phiDichVu(dv, m.Q, m.dong)) <= 2 + m.sl).length
    const du = Math.ceil(0.9 * mau.length)
    if (khop(PHI_DICH_VU_MAC_DINH) >= du) return PHI_DICH_VU_MAC_DINH
    const duoi = mau.filter(m => m.Q <= 600_000)
    if (duoi.length < SO_MAU_TOI_THIEU) return null
    const n = duoi.length
    const tbQ = trungBinh(duoi.map(m => m.Q)), tbP = trungBinh(duoi.map(m => m.dichVu))
    let cov = 0, varQ = 0
    for (const m of duoi) { cov += (m.Q - tbQ) * (m.dichVu - tbP); varQ += (m.Q - tbQ) ** 2 }
    if (!(varQ > 0) || n < 2) return null
    const a = Math.round((cov / varQ) / 0.0005) * 0.0005
    const b = Math.round((tbP - (cov / varQ) * tbQ) / 100) * 100
    if (!(a > 0 && a < 0.2) || !(b >= 0 && b <= 20_000)) return null
    /* đơn ra phí thấp hơn đường thẳng ⇒ đã chạm trần: trần = phí − phí/đơn (lấy lớn nhất). CHỈ đơn MỘT cái — trần theo từng cái,
     * đơn 2 cái chạm trần ra 2 × trần (21/11/2026). Không đơn một cái nào chạm ⇒ chưa biết trần (phí cao hơn = thận trọng). */
    const cham = mau.filter(m => m.sl === 1 && m.dichVu < a * m.Q + b - (2 + m.sl))
    const dv: PhiDichVu = { tyLe: a, moiDon: b, tran: cham.length ? Math.round(Math.max(...cham.map(m => m.dichVu - b))) : 0 }
    return khop(dv) >= du ? dv : null
}

/** Phí công thức của MỘT đơn mẫu (dùng Q, ship, voucher, bảo vệ, phí khác, affiliate THẬT của đơn) — để kiểm biểu phí. Thuế trên
 *  Q (đo 21/11/2026 ở đơn combo — osp ≠ Q). */
export function phiCongThucCuaDon(b: Pick<BieuPhi, 'thanhToan' | 'dichVu' | 'thue'>, phiNganh: number, m: MauEscrow): number {
    return (m.osp - m.Q) + phiNganh * m.Q + b.thanhToan * (m.Q + m.S) + phiDichVu(b.dichVu, m.Q, m.dong) + b.thue * m.Q + m.baoVe + m.khac + m.aff
}

/** Dung sai kiểm: max(1.000đ; 0,5% giá). */
export const dungSaiKiem = (osp: number) => Math.max(1000, 0.005 * osp)

/**
 * Lập biểu phí từ các đơn mẫu đã đọc escrow (hàm thuần). Không đủ mẫu / phí dịch vụ không ra công thức / công thức không khớp
 * phí thật ≥ 90% mẫu ⇒ hopLe = false kèm lyDo (Pilot dùng phí đo từ sổ như cũ).
 */
export function uocLuongBieuPhi(mauVao: (MauEscrow & { nganh: string })[], luc = Date.now(), soBo = 0): BieuPhi {
    const mau = (mauVao || []).filter(m => m && String(m.nganh || '').trim() && m.osp > 0 && m.Q > 0)
    const rong = (lyDo: string, them: Partial<BieuPhi> = {}): BieuPhi => ({
        phienBan: 1, doLuc: luc, hopLe: false, lyDo, soMau: mau.length, soKhop: 0, soBo,
        thanhToan: 0, dichVu: { tyLe: 0, moiDon: 0, tran: 0 }, thue: 0, baoVe: 0, khac: 0, voucher: 0, ship: 0,
        aff: { tyLeTB: 0, tyLeMax: 0, soMau: 0, soCo: 0 }, nganh: {}, ...them,
    })
    if (mau.length < SO_MAU_TOI_THIEU) {
        return rong(`Mới đọc được ${mau.length} đơn mẫu đã hoàn tất (cần ít nhất ${SO_MAU_TOI_THIEU}) — chưa lập được biểu phí, dùng phí đo từ sổ như cũ.`)
    }
    const nganh: Record<string, BieuPhiNganh> = {}
    for (const m of mau) {
        const k = String(m.nganh).trim(), r = m.hoaHong / m.Q
        const c = nganh[k]
        if (!c) nganh[k] = { tyLe: r, soMau: 1, min: r, max: r, lech: false }
        else { c.soMau++; c.min = Math.min(c.min, r); c.max = Math.max(c.max, r) }
    }
    /* Làm tròn tỷ lệ tới 0,01%: Shopee làm tròn TIỀN từng đơn (commission = round(% × Q)) nên commission / Q lệch ±0,5/Q
     * — đơn 20.000đ lệch tới 0,0025%, không làm tròn thì "11%" thành 11,0025% và max các đơn lấy đúng đơn lệch lên. */
    for (const c of Object.values(nganh)) {
        c.lech = c.max - c.min > LECH_NGANH
        c.min = tron(c.min, 1e4); c.max = tron(c.max, 1e4); c.tyLe = c.max
    }
    const thanhToan = tron(trungVi(mau.map(m => m.thanhToan / (m.Q + m.S))), 1e4)
    const thue = tron(trungVi(mau.map(m => m.thue / m.Q)), 1e4)   // thuế trên Q (21/11/2026)
    const dichVu = doPhiDichVu(mau)
    if (!dichVu) {
        return rong('Phí dịch vụ của các đơn mẫu không ra công thức "% × giá (có trần) + phí mỗi đơn" — Shopee có thể đã đổi cách tính; dùng phí đo từ sổ như cũ.', { nganh })
    }
    const soKhop = mau.filter(m => Math.abs(phiCongThucCuaDon({ thanhToan, dichVu, thue }, nganh[String(m.nganh).trim()]!.tyLe, m) - m.phi) <= dungSaiKiem(m.osp)).length
    if (soKhop < Math.ceil(0.9 * mau.length)) {
        return rong(`Công thức chỉ khớp phí thật ở ${soKhop}/${mau.length} đơn mẫu (cần ≥ 90%) — có khoản phí chưa nằm trong công thức; dùng phí đo từ sổ như cũ.`,
            { soKhop, thanhToan, dichVu, thue, nganh })
    }
    const tongOsp = mau.reduce((s, m) => s + m.osp, 0)
    return {
        phienBan: 1, doLuc: luc, hopLe: true, soMau: mau.length, soKhop, soBo,
        thanhToan, dichVu, thue,
        baoVe: Math.round(trungBinh(mau.map(m => m.baoVe))),
        khac: tron(trungBinh(mau.map(m => m.khac / m.osp)), 1e4),
        voucher: tron(trungBinh(mau.map(m => (m.osp - m.Q) / m.osp))),
        ship: Math.round(trungBinh(mau.map(m => m.S))),
        aff: {
            tyLeTB: tron(mau.reduce((s, m) => s + m.aff, 0) / tongOsp),
            tyLeMax: tron(Math.min(0.5, Math.max(0, ...mau.map(m => m.aff / m.osp)))),
            soMau: mau.length, soCo: mau.filter(m => m.aff > 0).length,
        },
        nganh,
    }
}

/** Biểu phí đọc từ JSON đã lưu — hỏng / thiếu trường ⇒ null (không bao giờ ném). */
export function chuanHoaBieuPhi(v: any): BieuPhi | null {
    if (!v || typeof v !== 'object' || v.phienBan !== 1) return null
    const doLuc = Number(v.doLuc)
    if (!(doLuc > 0)) return null
    const dv = v.dichVu || {}
    const nganh: Record<string, BieuPhiNganh> = {}
    for (const [k, c] of Object.entries(v.nganh && typeof v.nganh === 'object' ? v.nganh : {})) {
        const x: any = c
        const tyLe = Number(x?.tyLe)
        if (!k.trim() || !(tyLe > 0 && tyLe < 0.6)) continue
        nganh[k] = { tyLe, soMau: Math.max(0, Math.round(so(x.soMau))), min: so(x.min) || tyLe, max: so(x.max) || tyLe, lech: !!x.lech }
    }
    const b: BieuPhi = {
        phienBan: 1, doLuc, hopLe: v.hopLe === true, ...(v.lyDo ? { lyDo: String(v.lyDo).slice(0, 500) } : {}),
        soMau: Math.max(0, Math.round(so(v.soMau))), soKhop: Math.max(0, Math.round(so(v.soKhop))), soBo: Math.max(0, Math.round(so(v.soBo))),
        thanhToan: so(v.thanhToan), dichVu: { tyLe: so(dv.tyLe), moiDon: so(dv.moiDon), tran: Math.max(0, so(dv.tran)) },
        thue: so(v.thue), baoVe: Math.max(0, so(v.baoVe)), khac: Math.max(0, so(v.khac)), voucher: Math.max(0, so(v.voucher)), ship: Math.max(0, so(v.ship)),
        aff: { tyLeTB: Math.max(0, so(v.aff?.tyLeTB)), tyLeMax: Math.max(0, so(v.aff?.tyLeMax)), soMau: Math.max(0, so(v.aff?.soMau)), soCo: Math.max(0, so(v.aff?.soCo)) },
        nganh,
    }
    // số vô lý ⇒ coi như không hợp lệ (phí tỷ lệ cộng lại ≥ 60% giá là đọc hỏng, không phải biểu phí)
    if (b.hopLe && !(b.thanhToan >= 0 && b.thanhToan < 0.2 && b.thue >= 0 && b.thue < 0.1 && b.dichVu.tyLe >= 0 && b.dichVu.tyLe < 0.2
        && b.khac < 0.1 && b.voucher < 0.5 && Object.keys(nganh).length > 0)) b.hopLe = false
    return b
}

const pct = (r: number) => `${(Math.round(r * 10000) / 100).toLocaleString('vi-VN')}%`
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`
/** dd/mm/yyyy giờ Việt Nam */
export const ngayVN = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/')
const ngay = ngayVN

/** Các khoản chung cả gian — một cụm cho người đọc (không gồm % ngành, không gồm affiliate). */
export function moTaKhoanChung(b: BieuPhi): string {
    const v = Math.min(Math.max(b.voucher, 0), 0.5)
    return [
        `thanh toán ${pct(b.thanhToan)}`,
        `dịch vụ ${pct(b.dichVu.tyLe)}${b.dichVu.tran > 0 ? ` (tối đa ${vnd(b.dichVu.tran)}/cái)` : ''} + ${vnd(b.dichVu.moiDon)}/đơn`,
        `thuế ${pct(b.thue)}`,
        ...(b.baoVe ? [`bảo vệ vận chuyển ${vnd(b.baoVe)}/đơn`] : []),
        ...(b.khac ? [`nạp quảng cáo / hỗ trợ kỹ thuật ${pct(b.khac)}`] : []),
        ...(v ? [`voucher shop trung bình ${pct(v)}`] : []),
    ].join(' + ')
}

/**
 * Mô hình phí (MauPhi nguon 'cong-thuc') cho một sản phẩm có % phí cố định `phiNganh` — phí(P) theo giá đăng P của MỘT cái:
 *   v·P + (1 − v)·P·(phiNganh + thanhToan + dịch vụ% + thuế) + khác·P + phí dịch vụ/đơn + bảo vệ + thanhToan·ship
 *   (v = voucher shop trung bình; thuế trên Q = (1 − v)·P, đo 21/11/2026) — phần dịch vụ% tối đa `tran` MỖI CÁI ⇒ MauPhi.tran.
 *   Affiliate tính riêng (affiliate.tachRieng): bên gọi gắn `affiliate` (trung bình vào giá mục tiêu, mức cao nhất vào giá sàn).
 * soMauNganh = 0 ⇒ phiNganh là % TRUNG BÌNH các ngành (ngành chưa có đơn mẫu / phí cả gian) — bên gọi gắn thayNganh /
 * chuaRoNganh khi đó là phí của một sản phẩm.
 */
export function mauPhiCongThuc(b: BieuPhi, phiNganh: number, o: { soMauNganh: number; lech?: boolean }): MauPhi {
    const v = Math.min(Math.max(b.voucher, 0), 0.5), q = 1 - v
    const tyLe = v + q * (phiNganh + b.thanhToan + b.dichVu.tyLe + b.thue) + b.khac
    const coDinh = Math.round(b.dichVu.moiDon + b.baoVe + b.thanhToan * b.ship)
    const giam = b.dichVu.tran > 0 ? b.dichVu.tyLe * q : 0
    const moTa = moTaKhoanChung(b)
    const nganh = `phí cố định ${pct(phiNganh)}${o.soMauNganh ? ` (${o.soMauNganh} đơn mẫu của ngành${o.lech ? ', các đơn lệch nhau — lấy mức cao nhất' : ''})` : ' (trung bình các ngành có đơn mẫu)'}`
    return {
        tyLe, coDinh, nguon: 'cong-thuc', soDon: o.soMauNganh || b.soMau,
        ghiChu: `Phí tính theo biểu phí Shopee đọc thẳng từ escrow ${b.soMau} đơn mẫu (công thức khớp phí thật ${b.soKhop}/${b.soMau} đơn, đọc ngày ${ngay(b.doLuc)}): ` +
            `${nganh} + ${moTa}. Affiliate tính riêng.`,
        ...(giam > 0 ? { tran: { tuGia: b.dichVu.tran / giam, giam } } : {}),
        congThuc: { phiNganh, soMauNganh: o.soMauNganh, soMauGian: b.soMau, soKhop: b.soKhop, ...(o.lech ? { lech: true } : {}), doLuc: b.doLuc, moTa },
    }
}

/**
 * % phí cố định trung bình các ngành có mẫu — trọng số = số đơn một ngành của ngành đó trong sổ (90 ngày), ngành không có
 * trong sổ thì số mẫu. Dùng cho phí cả gian và sản phẩm thuộc ngành chưa có đơn mẫu (máy không tự hạ giá theo số này).
 */
export function phiNganhTrungBinh(b: BieuPhi, soDonNganh?: Map<string, number>): number {
    let tu = 0, mau = 0
    for (const [k, c] of Object.entries(b.nganh)) {
        const w = Math.max(soDonNganh?.get(k) ?? 0, c.soMau, 1)
        tu += c.tyLe * w; mau += w
    }
    return mau > 0 ? tron(tu / mau) : 0
}

/** Hoa hồng affiliate cho mô hình công thức: số đo cả gian từ sổ (nhiều đơn hơn) khi đủ đơn biết, không thì từ đơn mẫu;
 *  mức cao nhất lấy cả hai. Phí công thức KHÔNG gồm affiliate ⇒ tachRieng luôn true. */
export function affiliateCongThuc(b: BieuPhi, goc: AffiliateDo | undefined, soDonDuTin: number): AffiliateDo {
    const dungGoc = !!goc && goc.soDonBiet >= soDonDuTin
    return {
        tachRieng: true,
        tyLeTB: dungGoc ? goc!.tyLeTB : b.aff.tyLeTB,
        tyLeMax: Math.min(0.5, Math.max(goc?.tyLeMax ?? 0, b.aff.tyLeMax)),
        soDonBiet: dungGoc ? goc!.soDonBiet : b.aff.soMau,
        soDonCo: dungGoc ? goc!.soDonCo : b.aff.soCo,
    }
}

// ─── Chọn đơn mẫu + đọc escrow ──────────────────────────────────────────────────

/** Đơn mẫu: mỗi ngành ≤ SO_MAU_MOI_NGANH đơn COMPLETED 90 ngày mới nhất, MỌI dòng hàng nối được về cùng một ngành (cùng cách
 *  nối dòng → listing như shopeeTuQuan.dongPhiTheoNganh), ưu tiên đơn 1 cái. Xếp theo lượt (đơn đầu mọi ngành trước) để trần
 *  TRAN_MAU_MOI_GIAN cắt bớt đơn thứ hai / ba chứ không cắt mất ngành. Mã đơn chỉ dùng để hỏi Shopee — không ghi log. */
export async function chonDonMau(prisma: any, channelId: string, moiNganh = SO_MAU_MOI_NGANH, tran = TRAN_MAU_MOI_GIAN): Promise<{ sn: string; nganh: string }[]> {
    const rows: any[] = await prisma.$queryRawUnsafe(`
        WITH don AS (
            SELECT o.id, o."externalOrderId" AS sn, o."createdAt" AS luc
              FROM "OnlineOrder" o
             WHERE o."channelId" = $1 AND UPPER(COALESCE(o."externalStatus", '')) = 'COMPLETED'
               AND o."externalOrderId" IS NOT NULL AND o."externalOrderId" <> ''
               AND o."createdAt" >= NOW() - INTERVAL '90 days'
             ORDER BY o."createdAt" DESC
             LIMIT 3000
        ), dong AS (
            SELECT d.id, (SELECT p."categoryId" FROM "OnlineProduct" p
                           WHERE p."channelId" = $1 AND p."categoryId" IS NOT NULL
                             AND (p."platformProductId" = i."externalItemId"
                                  OR (i.sku IS NOT NULL AND i.sku <> '' AND LOWER(p.sku) = LOWER(i.sku))
                                  OR (i."productId" IS NOT NULL AND p."localProductId" = i."productId"))
                           ORDER BY (p."platformProductId" = i."externalItemId") DESC
                           LIMIT 1) AS nganh,
                   i.quantity AS sl
              FROM don d JOIN "OnlineOrderItem" i ON i."onlineOrderId" = d.id
        ), mot AS (
            SELECT d.sn, d.luc, MIN(x.nganh)::text AS nganh, SUM(x.sl) AS sl
              FROM don d JOIN dong x ON x.id = d.id
             GROUP BY d.id, d.sn, d.luc
            HAVING COUNT(DISTINCT x.nganh) = 1 AND COUNT(x.nganh) = COUNT(*)
        ), xep AS (
            SELECT sn, nganh, ROW_NUMBER() OVER (PARTITION BY nganh ORDER BY (sl = 1) DESC, luc DESC) AS hang FROM mot
        )
        SELECT sn, nganh FROM xep WHERE hang <= $2::int ORDER BY hang, nganh LIMIT $3::int`, channelId, moiNganh, tran)
    return (rows || []).map(r => ({ sn: String(r.sn || '').replace(/^SPE-/i, '').trim(), nganh: String(r.nganh || '').trim() }))
        .filter(r => r.sn && r.nganh)
}

/** Hỏi Shopee escrow của MỘT đơn — trả order_income hoặc null (đơn không thấy / Shopee báo lỗi). Lỗi mạng / proxy thì NÉM. */
export type DocEscrow = (sn: string) => Promise<any | null>

export function docEscrowQuaDichVu(svc: any): DocEscrow {
    return async (sn: string) => {
        const url = svc.apiUrl('/api/v2/payment/get_escrow_detail') + `&order_sn=${encodeURIComponent(sn)}`
        const d = await svc.httpGet(url)
        if (d?.error) {
            const e = String(d.error)
            // token hỏng / hết hạn / thiếu quyền / bị bóp hạn mức ⇒ đo tiếp chỉ tốn lượt gọi: NÉM để dừng cả lượt.
            // Lỗi của riêng đơn (không thấy đơn, tham số) ⇒ bỏ đơn đó.
            if (/auth|token|permission|sign|partner|shop|too_many|limit|busy|banned|forbidden/i.test(e)) {
                throw new Error(`Shopee từ chối đọc escrow: ${e} ${String(d.message || '').slice(0, 120)}`)
            }
            return null
        }
        return d?.response?.order_income ?? null
    }
}

/**
 * Đo biểu phí của một gian: chọn đơn mẫu ⇒ đọc escrow TUẦN TỰ ⇒ uocLuongBieuPhi. `docEscrow` truyền vào (bộ kiểm dùng bản giả;
 * prod dùng docEscrowQuaDichVu). Lỗi ném giữa chừng (mạng, token) ⇒ ném tiếp — không lập biểu phí từ nửa mẫu.
 */
export async function doBieuPhi(prisma: any, channelId: string, docEscrow: DocEscrow, o: { nghiMs?: number; luc?: number } = {}): Promise<BieuPhi> {
    const ds = await chonDonMau(prisma, channelId)
    const mau: (MauEscrow & { nganh: string })[] = []
    let soBo = 0
    for (let i = 0; i < ds.length; i++) {
        const x = ds[i]!
        const inc = await docEscrow(x.sn)
        const m = docMauEscrow(inc)
        if (m) mau.push({ ...m, nganh: x.nganh }); else soBo++
        if (o.nghiMs && i < ds.length - 1) await new Promise(r => setTimeout(r, o.nghiMs))
    }
    return uocLuongBieuPhi(mau, o.luc ?? Date.now(), soBo)
}

// ─── Lưu / đọc ──────────────────────────────────────────────────────────────────

const ID_DONG = 'bieu-phi'
const CO_BANG = new WeakMap<object, number>()

/** Bảng ShopeePilotConfig đã có chưa — dò to_regclass (không chạm bảng: bắt 42P01 vẫn in "Raw query failed"). Đệm 10 phút khi CÓ. */
async function coBang(prisma: any): Promise<boolean> {
    const het = CO_BANG.get(prisma)
    if (het && het > Date.now()) return true
    try {
        const r: any[] = await prisma.$queryRawUnsafe(`SELECT to_regclass('"ShopeePilotConfig"')::text AS t`)
        const co = !!(Array.isArray(r) && r[0] && r[0].t)
        if (co) CO_BANG.set(prisma, Date.now() + 10 * 60_000)
        return co
    } catch { return false }
}

/** Đệm biểu phí đã đọc theo client + gian, 60 giây — docMauPhiTheoNganh chạy cho TỪNG sản phẩm ở vài luồng. */
const demBieu = new WeakMap<object, Map<string, { het: number; b: BieuPhi | null }>>()
const TTL_DEM_BIEU = 60_000

/** Biểu phí đã lưu của gian (kể cả không hợp lệ / cũ) — null = chưa đo hoặc đọc hỏng. Không bao giờ ném. */
export async function docBieuPhi(prisma: any, channelId: string): Promise<BieuPhi | null> {
    const dem = prisma && typeof prisma === 'object' ? demBieu.get(prisma) : undefined
    const co = dem?.get(channelId)
    if (co && co.het > Date.now()) return co.b
    let b: BieuPhi | null = null
    if (await coBang(prisma)) {
        try {
            const r: any[] = await prisma.$queryRawUnsafe(`SELECT schedule FROM "ShopeePilotConfig" WHERE id = '${ID_DONG}'`)
            const raw = Array.isArray(r) && r[0] ? r[0].schedule : null
            if (typeof raw === 'string' && raw) b = chuanHoaBieuPhi(JSON.parse(raw)?.[channelId])
        } catch { b = null }
    }
    if (prisma && typeof prisma === 'object') {
        const m = demBieu.get(prisma) || new Map()
        m.set(channelId, { het: Date.now() + TTL_DEM_BIEU, b })
        demBieu.set(prisma, m)
    }
    return b
}

/** Ghi biểu phí của MỘT gian — một câu nguyên tử (jsonb_set), không đụng biểu phí gian khác. Chưa có bảng cấu hình Pilot thì
 *  tạo (chỉ bảng ShopeePilotConfig, cùng câu tạo lười của lib/shopeePilot). */
export async function luuBieuPhi(prisma: any, channelId: string, b: BieuPhi): Promise<void> {
    if (!(await coBang(prisma))) {
        const { SQL_TAO_BANG_PILOT } = await import('./shopeePilot')
        for (const sql of SQL_TAO_BANG_PILOT.filter(s => s.includes('"ShopeePilotConfig"'))) await prisma.$executeRawUnsafe(sql)
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "ShopeePilotConfig" (id, schedule) VALUES ('${ID_DONG}', $3)
        ON CONFLICT (id) DO UPDATE SET schedule = jsonb_set(
            COALESCE(NULLIF("ShopeePilotConfig".schedule, '')::jsonb, '{}'::jsonb), ARRAY[$1::text], $2::jsonb, true)::text`,
        channelId, JSON.stringify(b), JSON.stringify({ [channelId]: b }))
    CO_BANG.set(prisma, Date.now() + 10 * 60_000)
    demBieu.get(prisma)?.set(channelId, { het: Date.now() + TTL_DEM_BIEU, b })
}

/** Biểu phí DÙNG được: hợp lệ và chưa quá TUOI_BO. */
export const bieuPhiDungDuoc = (b: BieuPhi | null, bay = Date.now()): b is BieuPhi =>
    !!b && b.hopLe && bay - b.doLuc <= TUOI_BO && Object.keys(b.nganh).length > 0

// ─── Đo lại nền ─────────────────────────────────────────────────────────────────

/** Đo nền chỉ chạy trên máy chủ thật (Cloud Run đặt K_SERVICE) hoặc khi bật rõ BIEU_PHI_DO_NEN=1 — bộ kiểm chạy prisma giả,
 *  không được tự hỏi Shopee / làm mới token thật. */
const choDoNen = () => !!process.env.K_SERVICE || process.env.BIEU_PHI_DO_NEN === '1'

/** Lần thử gần nhất theo gian — trong MỘT bản (chạy trùng ở bản khác vô hại: kết quả như nhau). */
const thuLuc = new Map<string, number>()
/** Thử rồi (hỏng hay không) thì 6 giờ sau mới thử lại — đừng mỗi lần mở Pilot lại hỏi Shopee vài chục đơn. */
const NGHI_SAU_HONG = 6 * 3600_000

export interface KetQuaDo { bieu: BieuPhi | null; loi?: string }
/** Lượt đo đang chạy theo gian. */
const dangDoKq = new Map<string, Promise<KetQuaDo>>()

/** Đo + lưu biểu phí của gian (chờ được). Một gian chỉ một lượt đo cùng lúc trong bản này. Không bao giờ ném: lỗi ⇒ `loi`. */
export function doVaLuuBieuPhi(prisma: any, ch: any, moDichVu: (prisma: any, ch: any) => Promise<any>): Promise<KetQuaDo> {
    const k = String(ch.id)
    const co = dangDoKq.get(k)
    if (co) return co
    thuLuc.set(k, Date.now())
    const p = (async (): Promise<KetQuaDo> => {
        try {
            const svc = await moDichVu(prisma, ch)
            if (svc?.loiLamMoiToken) throw new Error(`token gian hỏng: ${svc.loiLamMoiToken}`)
            const b = await doBieuPhi(prisma, k, docEscrowQuaDichVu(svc), { nghiMs: 150 })
            await luuBieuPhi(prisma, k, b)
            console.log(`[BieuPhiShopee] ${ch.name || k}: ${b.hopLe ? `hợp lệ — ${b.soKhop}/${b.soMau} đơn mẫu khớp, ${Object.keys(b.nganh).length} ngành` : `KHÔNG hợp lệ — ${b.lyDo}`}`)
            return { bieu: b }
        } catch (e: any) {
            // lỗi mạng có thể kèm nguyên URL đã ký (access_token, sign, mã đơn) ⇒ che trước khi ghi log / trả admin
            const loi = String(e?.message || e).replace(/\b(access_token|sign|order_sn|partner_key)=[^&\s"']+/gi, '$1=…').slice(0, 300)
            console.warn(`[BieuPhiShopee] ${ch.name || k}: đo biểu phí hỏng —`, loi)
            return { bieu: null, loi }
        } finally { dangDoKq.delete(k) }
    })()
    dangDoKq.set(k, p)
    return p
}

/**
 * Đo lại MỘT gian Shopee có biểu phí cũ nhất (chưa có / quá TUOI_DO_LAI) của cửa hàng — CHỜ xong. Gọi từ lượt Pilot theo lịch
 * (trong request nhịp cron ⇒ có CPU; việc nền ngoài request bị Cloud Run hãm CPU). Mỗi lượt một gian ⇒ ≤ ~1 phút.
 */
export async function doBieuPhiGianCuNhat(prisma: any, moDichVu: (prisma: any, ch: any) => Promise<any>, bay = Date.now()): Promise<string> {
    if (!choDoNen()) return 'tat'
    const kenh: any[] = ((await prisma.onlineChannel.findMany({ where: { platform: 'shopee' }, orderBy: { createdAt: 'asc' } })) || [])
        .filter((c: any) => c?.id && c.accessToken && c.shopId)
    let chon: any = null, cuNhat = Infinity
    for (const c of kenh) {
        if (dangDoKq.has(String(c.id)) || bay - (thuLuc.get(String(c.id)) || 0) < NGHI_SAU_HONG) continue
        const luc = (await docBieuPhi(prisma, String(c.id)))?.doLuc ?? 0
        if (bay - luc < TUOI_DO_LAI) continue
        if (luc < cuNhat) { cuNhat = luc; chon = c }
    }
    if (!chon) return 'khong-can'
    const kq = await doVaLuuBieuPhi(prisma, chon, moDichVu)
    return kq.bieu ? `${chon.name}: ${kq.bieu.hopLe ? `hợp lệ ${kq.bieu.soKhop}/${kq.bieu.soMau}` : 'không hợp lệ'}` : `${chon.name}: hỏng`
}

/** Biểu phí cũ quá TUOI_DO_LAI (hoặc chưa có) ⇒ kích đo nền, KHÔNG chờ. Gian thiếu token / shop_id hoặc vừa hỏng ⇒ thôi. */
export function kichDoBieuPhiNen(prisma: any, ch: any, b: BieuPhi | null, moDichVu: (prisma: any, ch: any) => Promise<any>, bay = Date.now()): boolean {
    if (!choDoNen()) return false
    if (!ch?.id || String(ch.platform || '').toLowerCase() !== 'shopee' || !ch.accessToken || !ch.shopId) return false
    if (b && bay - b.doLuc < TUOI_DO_LAI) return false
    const k = String(ch.id)
    if (dangDoKq.has(k)) return false
    const thu = thuLuc.get(k) || 0
    if (bay - thu < NGHI_SAU_HONG) return false
    void doVaLuuBieuPhi(prisma, ch, moDichVu)
    return true
}

/** Bộ kiểm: quên lượt thử / lượt đang chạy. */
export function xoaTrangThaiDoBieuPhi(): void { dangDoKq.clear(); thuLuc.clear() }
