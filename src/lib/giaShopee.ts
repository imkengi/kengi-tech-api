/* ═══════════════════════════════════════════════════════════════════════════════
 *  TÍNH GIÁ ĐĂNG SHOPEE — lõi thuần (không DB, không mạng) cho AI tự quản shop
 *  (31/10/2026)
 *
 *  Chủ shop: "AI tự quản lý 1 trang Shopee riêng, tự đăng sản phẩm, tính toán mức
 *  giá để đăng và bán hàng". Phần này là "tính toán mức giá".
 *
 *  ─── MÔ HÌNH PHÍ ──────────────────────────────────────────────────────────────
 *  Phí Shopee của MỘT đơn = tyLe × giá bán + coDinh (phí cố định/đơn, vd phí hạ
 *  tầng). Hai tham số lấy từ CHÍNH DỮ LIỆU ĐƠN ĐÃ ĐỐI SOÁT của gian đó
 *  (OnlineOrder.platformFee = giá bán − thực nhận, xem ShopeeService.getEscrowDetail)
 *  — không gõ cứng biểu phí, vì biểu phí đổi theo ngành, theo gói Freeship/Voucher
 *  Xtra mà gian có tham gia hay không, và Shopee đổi biểu phí vài lần mỗi năm.
 *
 *  Gian mới chưa có đơn đối soát ⇒ rơi về OnlineChannel.commissionRate và NÓI RÕ
 *  là đang dùng số cấu hình (thường thấp hơn phí thật — mặc định 6%).
 *
 *  ─── CÔNG THỨC GIÁ ────────────────────────────────────────────────────────────
 *  Lãi = P − (tyLe·P + coDinh) − giáVốn − phíĐóngGói − quảngCáo%·P
 *  Muốn Lãi = biên%·P  ⇒  P = (giáVốn + coDinh + phíĐóngGói) / (1 − tyLe − biên% − quảngCáo%)
 *  Giá hoà vốn = cùng công thức với biên = 0.
 *  Tính cho đơn 1 sản phẩm (phí cố định gánh trọn) — chủ ý thận trọng.
 *
 *  ─── LUẬT AN TOÀN ─────────────────────────────────────────────────────────────
 *  - Thiếu giá vốn ⇒ KHÔNG tính giá (hopLe=false). Không biết vốn thì không biết lỗ.
 *  - Giá dưới SÀN (biên tối thiểu, mặc định 5% — cùng ngưỡng NGUONG_LOI_NHUAN_THAP,
 *    không bao giờ < 0) ⇒ công cụ ghi giá phải từ chối. AI không được bán lỗ.
 * ═══════════════════════════════════════════════════════════════════════════════ */

export interface DongPhiDon {
    /** giá bán của đơn trên sàn (thực nhận + phí) */
    giaBan: number
    /** tổng phí sàn đã khấu trừ */
    phi: number
}

export interface MauPhi {
    /** tỷ lệ phí theo giá bán, 0..1 */
    tyLe: number
    /** phí cố định mỗi đơn, VND */
    coDinh: number
    nguon: 'hoi-quy-don' | 'ty-le-don' | 'cau-hinh-kenh'
    soDon: number
    ghiChu: string
}

export const SO_DON_TOI_THIEU = 8
const SO_DON_HOI_QUY = 15

/**
 * Ước lượng phí sàn từ đơn đã đối soát. Đủ đơn và giá trải rộng ⇒ hồi quy tuyến tính
 * phí = a·giá + b (tách được phí cố định/đơn). Không thì tỷ lệ tổng phí / tổng giá.
 * Dưới SO_DON_TOI_THIEU đơn ⇒ dùng tỷ lệ cấu hình của kênh.
 */
export function uocLuongPhi(dong: DongPhiDon[], tyLeCauHinhPct: number): MauPhi {
    const ds = (dong || []).filter(d =>
        Number.isFinite(d.giaBan) && Number.isFinite(d.phi) && d.giaBan > 0 && d.phi >= 0 && d.phi < d.giaBan)
    const cauHinh = Math.min(Math.max(Number(tyLeCauHinhPct) || 0, 0), 60) / 100

    if (ds.length < SO_DON_TOI_THIEU) {
        return {
            tyLe: cauHinh, coDinh: 0, nguon: 'cau-hinh-kenh', soDon: ds.length,
            ghiChu: `Chưa đủ đơn đã đối soát (${ds.length}/${SO_DON_TOI_THIEU}) để đo phí thật — đang dùng tỷ lệ cấu hình của kênh ${round2(cauHinh * 100)}%. ` +
                'Phí Shopee thật thường CAO hơn (phí cố định + phí thanh toán + Freeship/Voucher Xtra) — giá tính ra có thể lãi ít hơn dự kiến.',
        }
    }

    const tongGia = ds.reduce((s, d) => s + d.giaBan, 0)
    const tongPhi = ds.reduce((s, d) => s + d.phi, 0)
    const tyLeTong = tongPhi / tongGia

    if (ds.length >= SO_DON_HOI_QUY) {
        const n = ds.length
        const tbGia = tongGia / n
        const tbPhi = tongPhi / n
        let cov = 0, varGia = 0
        for (const d of ds) {
            cov += (d.giaBan - tbGia) * (d.phi - tbPhi)
            varGia += (d.giaBan - tbGia) ** 2
        }
        const doLech = Math.sqrt(varGia / n) / tbGia   // hệ số biến thiên của giá
        if (varGia > 0 && doLech >= 0.2) {
            const a = cov / varGia
            const b = tbPhi - a * tbGia
            if (a > 0 && a < 0.5 && b >= 0 && b <= 50_000) {
                return {
                    tyLe: a, coDinh: Math.round(b), nguon: 'hoi-quy-don', soDon: n,
                    ghiChu: `Đo từ ${n} đơn đã đối soát: phí ≈ ${round2(a * 100)}% giá bán + ${Math.round(b).toLocaleString('vi-VN')}đ/đơn.`,
                }
            }
        }
    }
    return {
        tyLe: tyLeTong, coDinh: 0, nguon: 'ty-le-don', soDon: ds.length,
        ghiChu: `Đo từ ${ds.length} đơn đã đối soát: phí trung bình ${round2(tyLeTong * 100)}% giá bán (đã gồm phí cố định chia đều).`,
    }
}

export interface ThamSoGia {
    /** giá vốn 1 đơn vị bán */
    giaVon: number
    phi: { tyLe: number; coDinh: number }
    /** biên lãi mục tiêu trên giá bán, % */
    bienLoiNhuanPct: number
    /** biên tối thiểu — dưới mức này là "giá sàn", công cụ ghi từ chối. Mặc định 5, không < 0 */
    bienToiThieuPct?: number
    /** chi phí đóng gói / vật tư mỗi đơn, VND */
    phiDongGoi?: number
    /** % giá bán dành cho quảng cáo / voucher shop */
    phiQuangCaoPct?: number
    /** bước làm tròn LÊN, mặc định 1.000đ */
    lamTron?: number
    /** giới hạn giá của Shopee (get_item_limit) nếu biết */
    giaShopeeMin?: number
    giaShopeeMax?: number
}

export interface DanhGiaGia {
    gia: number
    phiSan: number
    loiNhuan: number
    bienPct: number
}

export interface KetQuaGia {
    hopLe: boolean
    lyDo?: string
    giaDeXuat: number
    /** giá thấp nhất được phép (đạt biên tối thiểu) */
    giaSan: number
    giaHoaVon: number
    duKien: DanhGiaGia | null
    canhBao: string[]
    thamSo: { giaVon: number; tyLePhiPct: number; phiCoDinh: number; phiDongGoi: number; phiQuangCaoPct: number; bienMucTieuPct: number; bienToiThieuPct: number; lamTron: number }
}

const round2 = (n: number) => Math.round(n * 100) / 100
const lamTronLen = (n: number, buoc: number) => Math.ceil(n / buoc) * buoc

/** Lãi của MỘT mức giá cụ thể (đơn 1 sản phẩm). */
export function danhGiaGia(gia: number, t: Pick<ThamSoGia, 'giaVon' | 'phi' | 'phiDongGoi' | 'phiQuangCaoPct'>): DanhGiaGia {
    const phiSan = t.phi.tyLe * gia + t.phi.coDinh
    const quangCao = ((t.phiQuangCaoPct || 0) / 100) * gia
    const loiNhuan = gia - phiSan - t.giaVon - (t.phiDongGoi || 0) - quangCao
    return {
        gia: Math.round(gia),
        phiSan: Math.round(phiSan),
        loiNhuan: Math.round(loiNhuan),
        bienPct: gia > 0 ? round2((loiNhuan / gia) * 100) : 0,
    }
}

/** Giá đạt đúng biên `bienPct` (chưa làm tròn). Infinity nếu mẫu số ≤ 0. */
function giaDatBien(t: ThamSoGia, bienPct: number): number {
    const mau = 1 - t.phi.tyLe - bienPct / 100 - (t.phiQuangCaoPct || 0) / 100
    if (mau <= 0.02) return Infinity
    return (t.giaVon + t.phi.coDinh + (t.phiDongGoi || 0)) / mau
}

export function tinhGiaDeXuat(t: ThamSoGia): KetQuaGia {
    const lamTron = t.lamTron && t.lamTron > 0 ? t.lamTron : 1000
    const bienToiThieu = Math.max(0, Number.isFinite(t.bienToiThieuPct as number) ? Number(t.bienToiThieuPct) : 5)
    const bienMucTieu = Math.max(bienToiThieu, Number(t.bienLoiNhuanPct) || 0)
    const thamSo = {
        giaVon: Math.round(t.giaVon || 0),
        tyLePhiPct: round2(t.phi.tyLe * 100),
        phiCoDinh: Math.round(t.phi.coDinh),
        phiDongGoi: Math.round(t.phiDongGoi || 0),
        phiQuangCaoPct: t.phiQuangCaoPct || 0,
        bienMucTieuPct: bienMucTieu,
        bienToiThieuPct: bienToiThieu,
        lamTron,
    }
    const hong = (lyDo: string): KetQuaGia => ({ hopLe: false, lyDo, giaDeXuat: 0, giaSan: 0, giaHoaVon: 0, duKien: null, canhBao: [], thamSo })

    if (!(t.giaVon > 0)) return hong('Sản phẩm CHƯA CÓ GIÁ VỐN — không tính được lãi/lỗ nên không đề xuất giá. Cập nhật giá vốn trước.')

    const tp: ThamSoGia = { ...t, bienLoiNhuanPct: bienMucTieu, bienToiThieuPct: bienToiThieu }
    const hoaVon = giaDatBien(tp, 0)
    const san = giaDatBien(tp, bienToiThieu)
    const mucTieu = giaDatBien(tp, bienMucTieu)
    if (!Number.isFinite(mucTieu)) {
        return hong(`Biên lãi ${bienMucTieu}% + phí sàn ${thamSo.tyLePhiPct}% + quảng cáo ${thamSo.phiQuangCaoPct}% đã gần/vượt 100% giá bán — không có giá nào đạt. Giảm biên hoặc quảng cáo.`)
    }

    const canhBao: string[] = []
    const giaSan = lamTronLen(san, 100)
    let giaDeXuat = lamTronLen(mucTieu, lamTron)
    if (t.giaShopeeMin && giaDeXuat < t.giaShopeeMin) {
        giaDeXuat = lamTronLen(t.giaShopeeMin, lamTron)
        canhBao.push(`Giá tính ra thấp hơn mức tối thiểu Shopee cho phép (${t.giaShopeeMin.toLocaleString('vi-VN')}đ) — đã nâng lên.`)
    }
    if (t.giaShopeeMax && giaDeXuat > t.giaShopeeMax) {
        return { ...hong(`Giá cần để đạt biên (${giaDeXuat.toLocaleString('vi-VN')}đ) vượt trần Shopee cho phép (${t.giaShopeeMax.toLocaleString('vi-VN')}đ).`), giaSan, giaHoaVon: Math.ceil(hoaVon) }
    }
    return {
        hopLe: true,
        giaDeXuat,
        giaSan,
        giaHoaVon: Math.ceil(hoaVon),
        duKien: danhGiaGia(giaDeXuat, tp),
        canhBao,
        thamSo,
    }
}

/**
 * Chặn giá trước khi GHI lên Shopee. Trả null nếu được, chuỗi lý do nếu bị chặn.
 * Dùng chung cho đăng mới và đổi giá — AI không có đường nào ghi giá dưới sàn.
 */
export function chanGiaDuoiSan(gia: number, kq: KetQuaGia): string | null {
    if (!kq.hopLe && kq.giaSan <= 0) return kq.lyDo || 'Không tính được giá sàn'
    if (!Number.isFinite(gia) || gia <= 0) return 'Giá không hợp lệ'
    if (gia < kq.giaSan) {
        return `Giá ${Math.round(gia).toLocaleString('vi-VN')}đ thấp hơn GIÁ SÀN ${kq.giaSan.toLocaleString('vi-VN')}đ ` +
            `(biên tối thiểu ${kq.thamSo.bienToiThieuPct}%; hoà vốn ${kq.giaHoaVon.toLocaleString('vi-VN')}đ) — không ghi.`
    }
    return null
}
