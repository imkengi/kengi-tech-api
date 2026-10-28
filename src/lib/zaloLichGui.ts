/**
 * GỬI ĐỊNH KỲ QUA ZALO — CÔNG NỢ / DOANH SỐ / TIN BẤT KỲ THEO LỊCH (26/10/2026)
 *
 * Chủ shop: "chưa có mấy cái như gửi công nợ định kỳ theo ngày hoặc theo tháng á".
 *
 * Một LỊCH = mẫu tin + người nhận + tần suất (hằng ngày / hằng tuần / ngày N hằng tháng, giờ VN).
 * Tới giờ, nhịp ngoài /api/cron/tick (qua lib/zaloGui.ts nhipGuiZalo) tạo MỘT đợt gửi bình thường
 * (ZaloDotGui) với số liệu CHỐT ngay lúc đó cho từng nhóm, rồi hàng đợi gửi giãn nhịp như mọi đợt.
 *
 * Biến: {tenKhach} {maKhach} {tenNhom} + công nợ {congNo} {ngayChot} + doanh số {doanhSo} {soLuong}
 * {soDon} {nhomHang} {tuNgay} {denNgay} theo kỳ TƯƠNG ĐỐI (hôm qua / tuần trước / tháng trước / tháng này)
 * + nhắc mua lại {thuHayMua} {hangLauKhongMua} {soMonLauKhongMua} (28/10/2026, lib/zaloNhacMuaLai.ts — lọc
 * doiTuong.chiKhachMaiHayMua: chỉ khách mà MAI là ngày hay mua và có món lâu chưa mua; nhóm hàng gợi ý doiTuong.nhomHangGoiY)
 * + giới thiệu sản phẩm mỗi ngày {tenSanPham} {maSanPham} {giaBan} {donVi} {moTaSanPham} {thuongHieu} {nhomHangSp} (28/10/2026,
 * lib/zaloGioiThieuSp.ts — lịch.gioiThieu: nguồn sản phẩm, mỗi lượt MỘT món xoay vòng cho mọi nhóm nhận, ảnh sản phẩm tự gửi kèm;
 * trạng thái xoay vòng ở cột gioiThieuDaGui, xem trước không ghi).
 *
 * AN TOÀN — gửi sai số nợ cho khách là việc không rút lại được:
 *  - {congNo} = Customer.debt, nguồn sự thật (HUTI: bản sao số dư KiotViet, webhook làm tươi ngay +
 *    đối chiếu hằng ngày). Cửa hàng nối KiotViet: lượt TỰ ĐỘNG chỉ chạy khi đối chiếu nợ thành công
 *    trong 48 giờ VÀ có webhook KiotViet trong 24 giờ; không thì bỏ lượt + báo chuông, không gửi số cũ.
 *    Đo 26/10/2026 (HUTI): đối chiếu chạy gần như hằng ngày (có lần cách 39 giờ), webhook ~1.000 lượt/ngày.
 *  - Lượt trước chưa gửi xong ⇒ bỏ lượt này (không chồng hai đợt nhắc nợ lên một nhóm).
 *  - Trễ quá 3 giờ (máy chủ không chạy đúng giờ) ⇒ bỏ, chờ lượt sau — nhắc nợ 8 giờ sáng mà 9 giờ tối
 *    mới tới là lạ.
 *  - Hai bản máy cùng chạy nhịp: giành lượt bằng so-và-ghi trên "lanToi".
 *  - Không nhóm nào cần gửi (vd không ai còn nợ) ⇒ không tạo đợt rỗng.
 *
 * Bảng ZaloLichGui tạo lười (cùng nếp lib/zaloKengi.ts) — KHÔNG thêm model Prisma.
 */

import crypto from 'crypto'
import { docTuyChon, luuTuyChonDot, type TuyChonTin } from './zaloTuyChon'
import { tinhDoanhSo, bienDoanhSo, dungBienDoanhSo, dinhTien, type CauHinhDoanhSo } from './zaloDoanhSo'
import { chonKenhGui, CAU_CHUA_CO_KENH, dienMau } from './zaloGui'
import { dungBienHomNay, canNoDauNgay, soNgayCuaKhach, bienHomNay } from './zaloGiaoDichNgay'
import { dungBienNhacMuaLai, thoiQuenMuaCuaKhach, maiLaNgayHayMua, bienNhacMuaLai } from './zaloNhacMuaLai'
import {
    docGioiThieu, dungBienGioiThieu, ungVienGioiThieu, chonSanPhamHomNay, thuTuSapToi, bienGioiThieu, anhGioiThieu, ghiDaGioiThieu,
    type GioiThieuSp, type DaGioiThieu, type SanPhamGioiThieu,
} from './zaloGioiThieuSp'

const BANG = '"ZaloLichGui"'
const LECH_VN_MS = 7 * 3600_000          // Việt Nam UTC+7, không đổi giờ
const TRE_TOI_DA_MS = 3 * 3600_000
const NO_TUOI_DOI_CHIEU_MS = 48 * 3600_000
const NO_TUOI_WEBHOOK_MS = 24 * 3600_000

// ─── Tần suất ────────────────────────────────────────────────────────────────

export interface TanSuat {
    loai: 'ngay' | 'tuan' | 'thang'
    gio: string           // "HH:mm" giờ VN
    thu?: number          // tuần: 1 = Thứ Hai … 7 = Chủ Nhật
    ngay?: number         // tháng: 1–31; 0 = ngày cuối tháng (tháng không có ngày đó ⇒ ngày cuối tháng)
}

export function docTanSuat(raw: any): TanSuat | string {
    if (!raw || typeof raw !== 'object') return 'Chọn tần suất gửi'
    const loai = String(raw.loai || '')
    if (loai !== 'ngay' && loai !== 'tuan' && loai !== 'thang') return 'Tần suất chỉ nhận hằng ngày / hằng tuần / hằng tháng'
    const gio = String(raw.gio || '')
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(gio)
    if (!m) return 'Giờ gửi phải dạng HH:mm (vd 08:00)'
    if (loai === 'tuan') {
        const thu = Number(raw.thu)
        if (!Number.isInteger(thu) || thu < 1 || thu > 7) return 'Chọn thứ trong tuần'
        return { loai, gio, thu }
    }
    if (loai === 'thang') {
        const ngay = Number(raw.ngay)
        if (!Number.isInteger(ngay) || ngay < 0 || ngay > 31) return 'Chọn ngày trong tháng (1–31 hoặc cuối tháng)'
        return { loai, gio, ngay }
    }
    return { loai, gio }
}

const soNgayTrongThang = (nam: number, thang0: number) => new Date(Date.UTC(nam, thang0 + 1, 0)).getUTCDate()

/** Lần chạy KẾ TIẾP sau mốc `sau` (lớn hơn hẳn). Tính trên giờ VN, trả về Date (UTC). */
export function tinhLanToi(ts: TanSuat, sau: Date): Date {
    const [hh, mm] = ts.gio.split(':').map(Number)
    const vn = new Date(sau.getTime() + LECH_VN_MS)            // đọc bằng getUTC* = đồng hồ VN
    const moc = (nam: number, thang0: number, ngay: number) => new Date(Date.UTC(nam, thang0, ngay, hh, mm) - LECH_VN_MS)
    if (ts.loai === 'ngay') {
        for (let i = 0; i < 3; i++) {
            const t = moc(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + i)
            if (t > sau) return t
        }
    }
    if (ts.loai === 'tuan') {
        const thuHomNay = ((vn.getUTCDay() + 6) % 7) + 1            // getUTCDay: 0 = CN ⇒ 7
        for (let i = 0; i < 15; i++) {
            if (((thuHomNay - 1 + i) % 7) + 1 !== ts.thu) continue
            const t = moc(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + i)
            if (t > sau) return t
        }
    }
    if (ts.loai === 'thang') {
        for (let i = 0; i < 14; i++) {
            const nam = vn.getUTCFullYear() + Math.floor((vn.getUTCMonth() + i) / 12)
            const thang0 = (vn.getUTCMonth() + i) % 12
            const cuoi = soNgayTrongThang(nam, thang0)
            const ngay = !ts.ngay ? cuoi : Math.min(ts.ngay, cuoi)
            const t = moc(nam, thang0, ngay)
            if (t > sau) return t
        }
    }
    throw new Error('Không tính được lần gửi kế tiếp')
}

const THU = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']

export function moTaTanSuat(ts: TanSuat): string {
    if (ts.loai === 'ngay') return `Hằng ngày lúc ${ts.gio}`
    if (ts.loai === 'tuan') return `${THU[ts.thu || 1]} hằng tuần lúc ${ts.gio}`
    return `${ts.ngay ? `Ngày ${ts.ngay}` : 'Ngày cuối'} hằng tháng lúc ${ts.gio}`
}

/** "08:00 01/11/2026" giờ VN */
export function gioVN(d: Date): string {
    const v = new Date(d.getTime() + LECH_VN_MS)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(v.getUTCHours())}:${p(v.getUTCMinutes())} ${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`
}

// ─── Kỳ doanh số tương đối ──────────────────────────────────────────────────

export type KyDoanhSo = 'hom_qua' | 'tuan_truoc' | 'thang_truoc' | 'thang_nay'
const KY_HOP_LE: KyDoanhSo[] = ['hom_qua', 'tuan_truoc', 'thang_truoc', 'thang_nay']

const ymdUtc = (d: Date) => d.toISOString().slice(0, 10)

/** Kỳ theo NGÀY VN tính từ lúc chạy. thang_nay = từ mùng 1 tới HÔM NAY. */
export function kyTuongDoi(ky: KyDoanhSo, luc: Date): { tu: string; den: string } {
    const v = new Date(luc.getTime() + LECH_VN_MS)
    const ngay = (nam: number, thang0: number, d: number) => ymdUtc(new Date(Date.UTC(nam, thang0, d)))
    const N = v.getUTCFullYear(), T = v.getUTCMonth(), D = v.getUTCDate()
    if (ky === 'hom_qua') { const h = ngay(N, T, D - 1); return { tu: h, den: h } }
    if (ky === 'tuan_truoc') {
        const thu = ((v.getUTCDay() + 6) % 7)                // 0 = Thứ Hai
        return { tu: ngay(N, T, D - thu - 7), den: ngay(N, T, D - thu - 1) }
    }
    if (ky === 'thang_truoc') return { tu: ngay(N, T - 1, 1), den: ngay(N, T, 0) }
    return { tu: ngay(N, T, 1), den: ngay(N, T, D) }
}

export const TEN_KY: Record<KyDoanhSo, string> = { hom_qua: 'hôm qua', tuan_truoc: 'tuần trước', thang_truoc: 'tháng trước', thang_nay: 'tháng này' }

// ─── Người nhận + doanh số ──────────────────────────────────────────────────

export interface DoiTuong {
    loai: 'tat_ca' | 'chon'; groupIds: string[]; chiKhachCoNo: boolean; noToiThieu: number
    /** Chỉ khách có MUA hoặc TRẢ TIỀN trong ngày (tổng kết cuối ngày — không nhắn khách không giao dịch) */
    chiKhachCoGiaoDich?: boolean
    /** Chỉ khách mà NGÀY MAI là thứ hay mua VÀ có món lâu chưa mua (nhắc mua lại trước một hôm — lib/zaloNhacMuaLai.ts) */
    chiKhachMaiHayMua?: boolean
    /** Nhóm hàng được gợi ý trong {hangLauKhongMua} (kể cả nhóm con); rỗng = mọi nhóm */
    nhomHangGoiY?: string[]
}
export interface DoanhSoDinhKy { categoryIds: string[]; ky: KyDoanhSo; chiKhachCoDoanhSo: boolean }

export function docDoiTuong(raw: any): DoiTuong | string {
    if (!raw || typeof raw !== 'object') return 'Chọn người nhận'
    const loai = raw.loai === 'chon' ? 'chon' : raw.loai === 'tat_ca' ? 'tat_ca' : null
    if (!loai) return 'Người nhận chỉ nhận "tất cả nhóm đã nối khách" hoặc "chọn nhóm"'
    const groupIds = [...new Set<string>((Array.isArray(raw.groupIds) ? raw.groupIds : []).map((g: any) => String(g ?? '').trim()).filter((g: string) => /^\d{6,25}$/.test(g)))]
    if (loai === 'chon' && !groupIds.length) return 'Chưa chọn nhóm nhận nào'
    if (groupIds.length > 2000) return 'Tối đa 2.000 nhóm'
    const noToiThieu = Math.max(0, Math.round(Number(raw.noToiThieu) || 0))
    const nhomHangGoiY = [...new Set<string>((Array.isArray(raw.nhomHangGoiY) ? raw.nhomHangGoiY : []).map(String).filter(Boolean))]
    if (nhomHangGoiY.length > 50) return 'Chọn tối đa 50 nhóm hàng gợi ý'
    return {
        loai, groupIds: loai === 'chon' ? groupIds : [], chiKhachCoNo: raw.chiKhachCoNo === true, noToiThieu,
        chiKhachCoGiaoDich: raw.chiKhachCoGiaoDich === true, chiKhachMaiHayMua: raw.chiKhachMaiHayMua === true, nhomHangGoiY,
    }
}

export function docDoanhSoDinhKy(raw: any): DoanhSoDinhKy | null | string {
    if (!raw || typeof raw !== 'object') return null
    const ky = String(raw.ky || '') as KyDoanhSo
    if (!KY_HOP_LE.includes(ky)) return 'Chọn kỳ doanh số (hôm qua / tuần trước / tháng trước / tháng này)'
    const categoryIds = [...new Set<string>((Array.isArray(raw.categoryIds) ? raw.categoryIds : []).map(String).filter(Boolean))]
    if (categoryIds.length > 50) return 'Chọn tối đa 50 nhóm hàng'
    return { categoryIds, ky, chiKhachCoDoanhSo: raw.chiKhachCoDoanhSo === true }
}

/** Mẫu tin có dùng biến công nợ? (chỉ khi đó mới cần nối khách + kiểm số nợ còn mới) */
export const dungBienCongNo = (noiDung: string) => /\{\s*(congNo|ngayChot)\s*\}/i.test(String(noiDung || ''))

/** Biến công nợ của MỘT khách — số CHỐT tại `luc` */
export const bienCongNo = (debt: number, luc: Date): Record<string, string> => ({ congNo: dinhTien(Math.max(0, Number(debt) || 0)), ngayChot: gioVN(luc) })

/**
 * Số nợ trong Kengi có đủ mới để gửi TỰ ĐỘNG không. Cửa hàng không nối KiotViet: Kengi chính là sổ ⇒ luôn được.
 * Nối KiotViet: cần đối chiếu nợ thành công ≤ 48 giờ VÀ webhook ≤ 24 giờ (webhook chết = khách trả nợ mà Kengi
 * không biết, gửi nhắc nợ cho người vừa trả là chuyện khó nói).
 */
export async function kiemSoNoTuoi(sp: any, bayGio = new Date()): Promise<{ ok: boolean; lyDo: string | null }> {
    const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
    if (!cfg || cfg.enabled === false) return { ok: true, lyDo: null }
    const dc = await sp.kiotVietSyncLog.findFirst({ where: { entity: 'doi-chieu-no', status: 'success' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }).catch(() => null)
    if (!dc?.startedAt || bayGio.getTime() - new Date(dc.startedAt).getTime() > NO_TUOI_DOI_CHIEU_MS) {
        return { ok: false, lyDo: `Chưa đối chiếu công nợ với KiotViet thành công trong 48 giờ qua${dc?.startedAt ? ` (lần cuối ${gioVN(new Date(dc.startedAt))})` : ''} — không gửi để khỏi báo sai số nợ` }
    }
    const wh = await sp.kiotVietSyncLog.findFirst({ where: { mode: 'webhook' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }).catch(() => null)
    if (!wh?.startedAt || bayGio.getTime() - new Date(wh.startedAt).getTime() > NO_TUOI_WEBHOOK_MS) {
        return { ok: false, lyDo: `24 giờ qua không nhận webhook nào từ KiotViet${wh?.startedAt ? ` (lần cuối ${gioVN(new Date(wh.startedAt))})` : ''} — có thể KiotViet đã tắt webhook, số nợ có thể cũ` }
    }
    return { ok: true, lyDo: null }
}

export interface DongGui { groupId: string; customerId: string | null; tenNhom: string | null; maKhach: string | null; tenKhach: string | null; bien: Record<string, string> | null; no: number | null }
export interface KetQuaSoan {
    dong: DongGui[]
    boChuaNoi: number      // nhóm chưa nối khách mà tin cần số của khách
    boKhongNo: number      // khách không nợ / nợ dưới mức tối thiểu
    boKhongMua: number     // khách không có doanh số trong kỳ
    boKhongGiaoDich: number   // khách không mua, không trả tiền trong ngày (lọc chiKhachCoGiaoDich)
    boKhongDenLuot: number    // mai không phải ngày hay mua, hoặc không có món lâu chưa mua (lọc chiKhachMaiHayMua)
    /** VẪN GỬI nhưng chưa có số nợ 0 giờ ⇒ tin bỏ dòng {noDauNgay} (zaloGui dienMau) */
    thieuNoDau: number
    doanhSo: (CauHinhDoanhSo & { nhomHang: string }) | null
    /** Giới thiệu sản phẩm (lib/zaloGioiThieuSp.ts): món của lượt này + thứ tự sắp tới; sanPham null = không món nào đủ điều kiện */
    gioiThieu: { sanPham: SanPhamGioiThieu | null; soUngVien: number; sapToi: SanPhamGioiThieu[]; soAnh: number } | null
}

/** Mô tả các nhóm bị bỏ (xem trước / kết quả lượt chạy) */
export function moTaBo(s: Pick<KetQuaSoan, 'boChuaNoi' | 'boKhongNo' | 'boKhongMua' | 'boKhongGiaoDich'> & { boKhongDenLuot?: number }): string {
    return [
        s.boKhongNo ? `${s.boKhongNo} khách không nợ / dưới mức` : '',
        s.boKhongGiaoDich ? `${s.boKhongGiaoDich} khách không mua / không trả tiền hôm nay` : '',
        s.boKhongDenLuot ? `${s.boKhongDenLuot} khách mai không phải ngày hay mua / không có món lâu chưa mua` : '',
        s.boKhongMua ? `${s.boKhongMua} khách không có doanh số` : '',
        s.boChuaNoi ? `${s.boChuaNoi} nhóm chưa nối khách` : '',
    ].filter(Boolean).join(', ')
}

/** Ai nhận + biến của từng nhóm, chốt tại `luc`. Dùng chung cho xem trước và lúc chạy thật. */
export async function soanNguoiNhan(
    sp: any,
    lich: { noiDung: string; doiTuong: DoiTuong; doanhSo: DoanhSoDinhKy | null; gioiThieu?: GioiThieuSp | null; gioiThieuDaGui?: DaGioiThieu | null },
    luc: Date,
): Promise<KetQuaSoan> {
    // Giới thiệu sản phẩm (lib/zaloGioiThieuSp.ts): MỘT món cho mọi nhóm nhận của lượt này. Không món nào đủ điều kiện ⇒ không ai nhận.
    let gioiThieu: KetQuaSoan['gioiThieu'] = null
    let bienSp: Record<string, string> = {}
    if (lich.gioiThieu) {
        const uv = await ungVienGioiThieu(sp, lich.gioiThieu)
        const sanPham = chonSanPhamHomNay(uv, lich.gioiThieuDaGui)
        gioiThieu = { sanPham, soUngVien: uv.length, sapToi: thuTuSapToi(uv, lich.gioiThieuDaGui, 5), soAnh: lich.gioiThieu.soAnh }
        if (!sanPham) return { dong: [], boChuaNoi: 0, boKhongNo: 0, boKhongMua: 0, boKhongGiaoDich: 0, boKhongDenLuot: 0, thieuNoDau: 0, doanhSo: null, gioiThieu }
        bienSp = bienGioiThieu(sanPham)
    }
    const canCongNo = dungBienCongNo(lich.noiDung)
    const canDoanhSo = dungBienDoanhSo(lich.noiDung) && !!lich.doanhSo
    const canHomNay = dungBienHomNay(lich.noiDung)
    const canNoDau = canNoDauNgay(lich.noiDung)
    const locGiaoDich = !!lich.doiTuong.chiKhachCoGiaoDich
    const canNhac = dungBienNhacMuaLai(lich.noiDung)
    const locMaiHayMua = !!lich.doiTuong.chiKhachMaiHayMua
    const canKhach = canCongNo || canDoanhSo || canHomNay || locGiaoDich || lich.doiTuong.chiKhachCoNo || canNhac || locMaiHayMua
    const nhom: any[] = await sp.zaloNhom.findMany({
        where: lich.doiTuong.loai === 'chon' ? { groupId: { in: lich.doiTuong.groupIds } } : { customerId: { not: null } },
        select: { groupId: true, customerId: true, tenNhom: true },
    })
    let boChuaNoi = 0, boKhongNo = 0, boKhongMua = 0, boKhongGiaoDich = 0, boKhongDenLuot = 0, thieuNoDau = 0
    // Nhóm đã chọn mà chưa có trong bảng nối (chỉ quét thấy) — vẫn gửi được nếu tin không cần số của khách
    if (lich.doiTuong.loai === 'chon') {
        const coSan = new Set(nhom.map(n => n.groupId))
        const quet: any[] = await sp.zaloNhomQuet.findMany({ where: { groupId: { in: lich.doiTuong.groupIds.filter(g => !coSan.has(g)) } }, select: { groupId: true, tenNhom: true } })
        const tenQuet = new Map(quet.map(q => [q.groupId, q.tenNhom]))
        for (const g of lich.doiTuong.groupIds) if (!coSan.has(g)) nhom.push({ groupId: g, customerId: null, tenNhom: tenQuet.get(g) || null })
    }
    const ids = [...new Set<string>(nhom.map(n => n.customerId).filter(Boolean))]
    const khach: any[] = ids.length ? await sp.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, debt: true } }) : []
    const theoId = new Map(khach.map(k => [k.id, k]))

    let ds: { theoKhach: Map<string, any>; nhomHang: string } | null = null
    let cfgDs: CauHinhDoanhSo | null = null
    if (canDoanhSo && lich.doanhSo) {
        const { tu, den } = kyTuongDoi(lich.doanhSo.ky, luc)
        cfgDs = { categoryIds: lich.doanhSo.categoryIds, tu, den, chiKhachCoDoanhSo: lich.doanhSo.chiKhachCoDoanhSo }
        ds = await tinhDoanhSo(sp, cfgDs, ids)
    }
    // Mua / trả trong ngày (lib/zaloGiaoDichNgay.ts) — cần cho biến hôm nay và cho bộ lọc "có giao dịch"
    const ngay = canHomNay || locGiaoDich ? await soNgayCuaKhach(sp, khach.map(k => ({ id: k.id, debt: k.debt })), luc) : null
    // Thứ hay mua + món lâu chưa mua (lib/zaloNhacMuaLai.ts) — cần cho biến nhắc mua lại và bộ lọc "mai là ngày hay mua"
    const thoiQuen = canNhac || locMaiHayMua ? await thoiQuenMuaCuaKhach(sp, khach.map(k => k.id), { luc, categoryIds: lich.doiTuong.nhomHangGoiY || [] }) : null

    const dong: DongGui[] = []
    for (const n of nhom) {
        const k = n.customerId ? theoId.get(n.customerId) : null
        if (canKhach && !k) { boChuaNoi++; continue }
        const no = k ? Number(k.debt) || 0 : null
        if (lich.doiTuong.chiKhachCoNo && !(no !== null && no > 0 && no >= lich.doiTuong.noToiThieu)) { boKhongNo++; continue }
        const sn = k && ngay ? ngay.theoKhach.get(k.id) : undefined
        if (locGiaoDich && !(sn && (sn.mua > 0 || sn.daTra > 0))) { boKhongGiaoDich++; continue }
        const tq = k && thoiQuen ? thoiQuen.get(k.id) : undefined
        if (locMaiHayMua && !(maiLaNgayHayMua(tq, luc) && tq!.mon.length)) { boKhongDenLuot++; continue }
        let bien: Record<string, string> = { ...bienSp }
        if (canCongNo && no !== null) bien = { ...bien, ...bienCongNo(no, luc) }
        if (canNhac) bien = { ...bien, ...bienNhacMuaLai(tq) }
        if (canHomNay && sn) {
            // Chưa có số nợ 0 giờ ⇒ vẫn gửi; dienMau bỏ dòng {noDauNgay} (26/10/2026)
            if (canNoDau && sn.noDau === null) thieuNoDau++
            bien = { ...bien, ...bienHomNay(sn, luc) }
        }
        if (ds && cfgDs && k) {
            const s = ds.theoKhach.get(k.id)
            if (cfgDs.chiKhachCoDoanhSo && !(s && s.tien > 0)) { boKhongMua++; continue }
            bien = { ...bien, ...bienDoanhSo(s, cfgDs, ds.nhomHang) }
        }
        dong.push({
            groupId: n.groupId, customerId: k?.id || null, tenNhom: n.tenNhom || null,
            maKhach: k?.code || null, tenKhach: k?.name || null, bien: Object.keys(bien).length ? bien : null, no,
        })
    }
    return { dong, boChuaNoi, boKhongNo, boKhongMua, boKhongGiaoDich, boKhongDenLuot, thieuNoDau, doanhSo: cfgDs && ds ? { ...cfgDs, nhomHang: ds.nhomHang } : null, gioiThieu }
}

/** Tin mẫu đã điền cho một dòng (xem trước) */
export const tinMau = (noiDung: string, d: DongGui | undefined) =>
    d ? dienMau(noiDung, { tenKhach: d.tenKhach, maKhach: d.maKhach, tenNhom: d.tenNhom, bien: d.bien }) : noiDung

// ─── Bảng ZaloLichGui ────────────────────────────────────────────────────────

export interface LichGui {
    id: string; ten: string; noiDung: string; anh: string[]
    tuyChon: TuyChonTin; doiTuong: DoiTuong; doanhSo: DoanhSoDinhKy | null; tanSuat: TanSuat
    /** Giới thiệu sản phẩm (28/10/2026) + trạng thái xoay vòng {productId: ISO}; lịch cũ không có ⇒ null */
    gioiThieu?: GioiThieuSp | null; gioiThieuDaGui?: DaGioiThieu | null
    bat: boolean; lanToi: string | null; lanCuoi: string | null; lanCuoiDotId: string | null; lanCuoiKetQua: string | null
    nguoiTao: string | null; createdAt: string; updatedAt: string
}

const daTaoBang = new Set<string>()

async function tenSchema(sp: any): Promise<string> {
    const s = (sp as any).__schema
    if (typeof s === 'string' && s) return s
    const r: any[] = await sp.$queryRawUnsafe('SELECT current_schema() AS s')
    return String(r[0]?.s || 'mac-dinh')
}

async function damBaoBang(sp: any): Promise<void> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return
    try {
        await sp.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${BANG} (
            "id" TEXT PRIMARY KEY,
            "ten" TEXT NOT NULL,
            "noiDung" TEXT NOT NULL,
            "anh" TEXT,
            "tuyChon" TEXT,
            "doiTuong" TEXT NOT NULL,
            "doanhSo" TEXT,
            "tanSuat" TEXT NOT NULL,
            "bat" BOOLEAN NOT NULL DEFAULT true,
            "lanToi" TIMESTAMP(3),
            "lanCuoi" TIMESTAMP(3),
            "lanCuoiDotId" TEXT,
            "lanCuoiKetQua" TEXT,
            "nguoiTao" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
            "gioiThieu" TEXT,
            "gioiThieuDaGui" TEXT
        )`)
    } catch (e: any) {
        if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
    }
    await damBaoCot(sp)
    daTaoBang.add(schema)
}

/** Cột thêm SAU khi bảng đã có ở cửa hàng (28/10/2026: giới thiệu sản phẩm) — idempotent, một lần mỗi tiến trình mỗi cửa hàng */
async function damBaoCot(sp: any): Promise<void> {
    for (const cot of ['gioiThieu', 'gioiThieuDaGui']) {
        try { await sp.$executeRawUnsafe(`ALTER TABLE ${BANG} ADD COLUMN IF NOT EXISTS "${cot}" TEXT`) }
        catch (e: any) { if (!/already exists|duplicate column/i.test(String(e?.message || ''))) throw e }
    }
}

/** Có bảng chưa — nhịp nền dùng cái này để KHÔNG tạo bảng ở cửa hàng chưa từng đặt lịch */
async function coBang(sp: any): Promise<boolean> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return true
    const r: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('"ZaloLichGui"') IS NOT NULL AS co`)
    if (r[0]?.co) { await damBaoCot(sp); daTaoBang.add(schema) }   // nhớ "đã có" — nhịp mỗi phút khỏi hỏi lại
    return !!r[0]?.co
}

const json = (s: any, mac: any) => { try { return s ? JSON.parse(s) : mac } catch { return mac } }
const isoHoacNull = (d: any) => (d ? new Date(d).toISOString() : null)
/** Giờ UTC dạng "không múi giờ" — cột TIMESTAMP(3) như mọi cột Prisma; so với now() AT TIME ZONE 'UTC' */
const gioUtc = (d: Date) => d.toISOString().replace('Z', '')

function docDong(r: any): LichGui {
    const tc = docTuyChon(json(r.tuyChon, null), false)
    return {
        id: r.id, ten: r.ten, noiDung: r.noiDung, anh: json(r.anh, []),
        tuyChon: typeof tc === 'string' ? { mucDo: 0, nhacCaNhom: false, tuXoa: 0, henGio: null } : tc,
        doiTuong: json(r.doiTuong, { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0 }),
        doanhSo: json(r.doanhSo, null), tanSuat: json(r.tanSuat, { loai: 'thang', gio: '08:00', ngay: 1 }),
        gioiThieu: json(r.gioiThieu, null), gioiThieuDaGui: json(r.gioiThieuDaGui, null),
        bat: !!r.bat, lanToi: isoHoacNull(r.lanToi), lanCuoi: isoHoacNull(r.lanCuoi),
        lanCuoiDotId: r.lanCuoiDotId || null, lanCuoiKetQua: r.lanCuoiKetQua || null,
        nguoiTao: r.nguoiTao || null, createdAt: isoHoacNull(r.createdAt)!, updatedAt: isoHoacNull(r.updatedAt)!,
    }
}

export async function dsLich(sp: any): Promise<LichGui[]> {
    if (!(await coBang(sp))) return []
    const rows: any[] = await sp.$queryRawUnsafe(`SELECT * FROM ${BANG} ORDER BY "createdAt" DESC LIMIT 100`)
    return rows.map(docDong)
}

export async function layLich(sp: any, id: string): Promise<LichGui | null> {
    if (!(await coBang(sp))) return null
    const rows: any[] = await sp.$queryRawUnsafe(`SELECT * FROM ${BANG} WHERE "id" = $1`, id)
    return rows[0] ? docDong(rows[0]) : null
}

export interface DuLieuLich {
    ten: string; noiDung: string; anh: string[]; tuyChon: TuyChonTin; doiTuong: DoiTuong; doanhSo: DoanhSoDinhKy | null; tanSuat: TanSuat
    /** Giới thiệu sản phẩm mỗi lượt (lib/zaloGioiThieuSp.ts); null = lịch thường */
    gioiThieu: GioiThieuSp | null
    /** Lần chạy ĐẦU không sớm hơn mốc này (tab Gửi tin: "hẹn 08:00 mai, lặp hằng ngày" ⇒ không chạy 08:00 hôm nay) */
    batDauTu: Date | null
}

/** Kiểm thân request tạo / sửa lịch. Trả CHUỖI = lỗi để báo người dùng. */
export function docDuLieuLich(b: any): DuLieuLich | string {
    const ten = String(b?.ten || '').trim().slice(0, 120)
    if (!ten) return 'Đặt tên cho lịch gửi (vd: Nhắc công nợ đầu tháng)'
    const noiDung = String(b?.noiDung || '').trim()
    const anh = (Array.isArray(b?.anh) ? b.anh : []).map(String).filter((u: string) => /^https:\/\//.test(u)).slice(0, 10)
    if (!noiDung && !anh.length) return 'Tin trống — nhập nội dung hoặc thêm ảnh'
    if (noiDung.length > 4000) return 'Nội dung tối đa 4.000 ký tự'
    const tuyChon = docTuyChon(b?.tuyChon, false)
    if (typeof tuyChon === 'string') return tuyChon
    const doiTuong = docDoiTuong(b?.doiTuong)
    if (typeof doiTuong === 'string') return doiTuong
    const doanhSo = docDoanhSoDinhKy(b?.doanhSo)
    if (typeof doanhSo === 'string') return doanhSo
    if (dungBienDoanhSo(noiDung) && !doanhSo) return 'Tin có {doanhSo} — chọn kỳ và nhóm hàng cho doanh số'
    const gioiThieu = docGioiThieu(b?.gioiThieu)
    if (typeof gioiThieu === 'string') return gioiThieu
    if (dungBienGioiThieu(noiDung) && !gioiThieu) return 'Tin có {tenSanPham} — chọn sản phẩm hoặc nhóm hàng để giới thiệu'
    const tanSuat = docTanSuat(b?.tanSuat)
    if (typeof tanSuat === 'string') return tanSuat
    let batDauTu: Date | null = null
    if (b?.batDauTu) {
        const t = Date.parse(String(b.batDauTu))
        if (!Number.isFinite(t)) return 'Giờ bắt đầu không hợp lệ'
        if (t > Date.now() + 31 * 86_400_000) return 'Chỉ hẹn bắt đầu trước tối đa 31 ngày'
        batDauTu = t > Date.now() ? new Date(t) : null
    }
    return { ten, noiDung, anh, tuyChon, doiTuong, doanhSo, gioiThieu, tanSuat, batDauTu }
}

/** Lần chạy đầu: lần kế tiếp theo tần suất, nhưng KHÔNG sớm hơn batDauTu (đúng mốc thì chạy luôn mốc đó) */
export function lanDau(ts: TanSuat, batDauTu: Date | null, bayGio = new Date()): Date {
    const tu = batDauTu && batDauTu > bayGio ? new Date(batDauTu.getTime() - 1000) : bayGio
    return tinhLanToi(ts, tu)
}

export async function taoLich(sp: any, d: DuLieuLich, nguoi: string | null, bayGio = new Date()): Promise<LichGui> {
    await damBaoBang(sp)
    const id = crypto.randomUUID()
    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG} ("id", "ten", "noiDung", "anh", "tuyChon", "doiTuong", "doanhSo", "tanSuat", "bat", "lanToi", "nguoiTao", "gioiThieu")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9::timestamp(3), $10, $11)`,
        id, d.ten, d.noiDung, JSON.stringify(d.anh), JSON.stringify({ ...d.tuyChon, henGio: null }), JSON.stringify(d.doiTuong),
        d.doanhSo ? JSON.stringify(d.doanhSo) : null, JSON.stringify(d.tanSuat), gioUtc(lanDau(d.tanSuat, d.batDauTu, bayGio)), nguoi,
        d.gioiThieu ? JSON.stringify(d.gioiThieu) : null)
    return (await layLich(sp, id))!
}

/** Sửa lịch — giờ chạy kế tiếp tính lại theo tần suất mới (sửa giờ / đổi tần suất là có hiệu lực ngay) */
export async function suaLich(sp: any, id: string, d: DuLieuLich, bayGio = new Date()): Promise<LichGui | null> {
    if (!(await coBang(sp))) return null
    const n = await sp.$executeRawUnsafe(
        `UPDATE ${BANG} SET "ten" = $2, "noiDung" = $3, "anh" = $4, "tuyChon" = $5, "doiTuong" = $6, "doanhSo" = $7, "tanSuat" = $8,
            "lanToi" = $9::timestamp(3), "gioiThieu" = $10, "updatedAt" = now() WHERE "id" = $1`,
        id, d.ten, d.noiDung, JSON.stringify(d.anh), JSON.stringify({ ...d.tuyChon, henGio: null }), JSON.stringify(d.doiTuong),
        d.doanhSo ? JSON.stringify(d.doanhSo) : null, JSON.stringify(d.tanSuat), gioUtc(lanDau(d.tanSuat, d.batDauTu, bayGio)),
        d.gioiThieu ? JSON.stringify(d.gioiThieu) : null)
    return Number(n) ? layLich(sp, id) : null
}

/** Bật lại thì tính giờ kế tiếp từ BÂY GIỜ — không gửi bù các lượt đã qua lúc đang tắt */
export async function datBat(sp: any, id: string, bat: boolean, bayGio = new Date()): Promise<LichGui | null> {
    const l = await layLich(sp, id)
    if (!l) return null
    await sp.$executeRawUnsafe(`UPDATE ${BANG} SET "bat" = $2, "lanToi" = $3::timestamp(3), "updatedAt" = now() WHERE "id" = $1`,
        id, bat, gioUtc(tinhLanToi(l.tanSuat, bayGio)))
    return layLich(sp, id)
}

export async function xoaLich(sp: any, id: string): Promise<boolean> {
    if (!(await coBang(sp))) return false
    return Number(await sp.$executeRawUnsafe(`DELETE FROM ${BANG} WHERE "id" = $1`, id)) > 0
}

async function ghiKetQua(sp: any, id: string, ketQua: string, dotId: string | null, luc: Date): Promise<void> {
    await sp.$executeRawUnsafe(
        `UPDATE ${BANG} SET "lanCuoi" = $2::timestamp(3), "lanCuoiKetQua" = $3, "lanCuoiDotId" = COALESCE($4, "lanCuoiDotId"), "updatedAt" = now() WHERE "id" = $1`,
        id, gioUtc(luc), ketQua.slice(0, 500), dotId)
}

/** Báo chuông một lần cho mỗi lượt bỏ qua (dấu theo lịch + giờ) — lượt tự động bị chặn mà im lặng là chủ shop tưởng đã gửi */
async function baoBoLuot(sp: any, lich: LichGui, lyDo: string, luc: Date): Promise<void> {
    try {
        const dau = `[lich-zalo:${lich.id.slice(0, 8)}:${gioVN(luc).slice(0, 2)}${gioVN(luc).slice(6, 16)}]`
        const da = await sp.notification.findFirst({ where: { message: { contains: dau } }, select: { id: true } })
        if (da) return
        const tieuDe = `Lịch gửi Zalo "${lich.ten}" chưa gửi`
        const tin = await sp.notification.create({ data: { type: 'warning', title: tieuDe.slice(0, 200), message: `${lyDo}. Vào Chăm Sóc Khách Hàng › Gửi định kỳ để xem / chạy tay. ${dau}`.slice(0, 1000) } })
        const { sendPushToStore } = await import('../routes/notifications')
        await sendPushToStore(sp, tieuDe, lyDo.slice(0, 300), { id: tin?.id, type: 'warning' })
    } catch (e: any) {
        console.warn(`[lich-zalo] không gửi được thông báo bỏ lượt — ${String(e?.message || e).slice(0, 120)}`)
    }
}

export interface KetQuaChay { dotId: string | null; soNhom: number; ketQua: string; boQua: boolean; canXacNhan?: boolean }

/**
 * Chạy MỘT lượt của lịch: chốt số liệu, tạo đợt gửi. `thuCong` = bấm "Chạy ngay" (không xét trễ giờ;
 * số nợ chưa đủ mới thì trả canXacNhan để người bấm quyết, trừ khi `boQuaKiemTraNo`).
 */
export async function chayLich(sp: any, lich: LichGui, opt: { thuCong?: boolean; boQuaKiemTraNo?: boolean; bayGio?: Date } = {}): Promise<KetQuaChay> {
    const luc = opt.bayGio || new Date()
    const boQua = async (ketQua: string, bao = true): Promise<KetQuaChay> => {
        await ghiKetQua(sp, lich.id, ketQua, null, luc)
        if (bao && !opt.thuCong) await baoBoLuot(sp, lich, ketQua, luc)
        return { dotId: null, soNhom: 0, ketQua, boQua: true }
    }
    // Lượt trước chưa gửi xong ⇒ không chồng đợt mới lên cùng các nhóm
    if (lich.lanCuoiDotId) {
        const con = await sp.zaloDotGuiNhom.count({ where: { dotId: lich.lanCuoiDotId, trangThai: { in: ['cho', 'dang'] } } })
        if (con > 0) return boQua(`Lượt trước còn ${con} nhóm chưa gửi xong — bỏ lượt ${gioVN(luc)}`)
    }
    const ch = await sp.zaloCauHinh.findUnique({ where: { id: 'default' } })
    const { kenh, tamDung } = await chonKenhGui(sp, ch)
    if (!kenh) return boQua(tamDung || CAU_CHUA_CO_KENH)
    // Số nợ / nợ đầu ngày (ảnh chụp số dư) đều cần số dư còn mới
    if ((dungBienCongNo(lich.noiDung) || canNoDauNgay(lich.noiDung)) && !opt.boQuaKiemTraNo) {
        const t = await kiemSoNoTuoi(sp, luc)
        if (!t.ok) {
            if (opt.thuCong) return { dotId: null, soNhom: 0, ketQua: t.lyDo!, boQua: true, canXacNhan: true }
            return boQua(t.lyDo!)
        }
    }
    const soan = await soanNguoiNhan(sp, lich, luc)
    const sanPham = soan.gioiThieu?.sanPham || null
    // Lịch giới thiệu sản phẩm mà không món nào đủ điều kiện (hết hàng / chưa có ảnh / nguồn trống): KHÔNG bình thường ⇒ báo chuông
    if (soan.gioiThieu && !sanPham) {
        return boQua('Không có sản phẩm nào đủ điều kiện để giới thiệu — kiểm lại nguồn sản phẩm của lịch ("còn hàng", "có ảnh", nhóm hàng)')
    }
    if (!soan.dong.length) {
        const vi = moTaBo(soan)
        // Bỏ vì không ai nợ / không ai mua là bình thường ⇒ không báo chuông
        return boQua(`Không có nhóm nào cần gửi${vi ? ` (${vi})` : ''}`, false)
    }
    // Ảnh sản phẩm (ảnh đại diện trước) đi TRƯỚC ảnh thêm của lịch; tổng tối đa 10 như mọi đợt
    const anhDot = sanPham && soan.gioiThieu ? [...anhGioiThieu(sanPham, soan.gioiThieu.soAnh), ...lich.anh].slice(0, 10) : lich.anh
    const dot = await sp.zaloDotGui.create({
        data: {
            tieuDe: `${lich.ten} — ${gioVN(luc).slice(0, 11)}${sanPham ? ` · ${sanPham.name}` : ''}`.slice(0, 200), noiDung: lich.noiDung, anh: JSON.stringify(anhDot),
            soNhom: soan.dong.length, nguoiTao: `lich:${lich.id}`, doanhSo: soan.doanhSo ? JSON.stringify(soan.doanhSo) : null,
        },
    })
    // Tuỳ chọn ghi TRƯỚC khi có hàng chờ (cùng luật với /dot-gui)
    await luuTuyChonDot(sp, dot.id, { ...lich.tuyChon, henGio: null })
    await sp.zaloDotGuiNhom.createMany({
        data: soan.dong.map(d => ({ dotId: dot.id, groupId: d.groupId, customerId: d.customerId, tenNhom: d.tenNhom, bien: d.bien ? JSON.stringify(d.bien) : null })),
        skipDuplicates: true,
    })
    // Ghi "đã giới thiệu" ⇒ lượt sau xoay sang món khác (xem trước không đi qua đây nên không ghi)
    if (sanPham) {
        await sp.$executeRawUnsafe(`UPDATE ${BANG} SET "gioiThieuDaGui" = $2, "updatedAt" = now() WHERE "id" = $1`,
            lich.id, JSON.stringify(ghiDaGioiThieu(lich.gioiThieuDaGui, sanPham.id, luc)))
    }
    const bo = moTaBo(soan)
    const thieu = soan.thieuNoDau ? `; ${soan.thieuNoDau} tin không có dòng "nợ đầu ngày" (chưa có số nợ 0 giờ)` : ''
    const ketQua = `Đã xếp ${soan.dong.length} nhóm${bo ? ` (bỏ ${bo})` : ''}${thieu}${sanPham ? ` · giới thiệu "${sanPham.name}"` : ''}${opt.thuCong ? ' — chạy tay' : ''}`
    await ghiKetQua(sp, lich.id, ketQua, dot.id, luc)
    return { dotId: dot.id, soNhom: soan.dong.length, ketQua, boQua: false }
}

/** Nhịp mỗi phút cho MỘT cửa hàng (gọi từ nhipGuiZalo). Cửa hàng chưa từng đặt lịch: không tạo bảng, không làm gì. */
export async function nhipLichGui(sp: any, bayGio = new Date()): Promise<string> {
    if (!(await coBang(sp))) return ''
    const den: any[] = await sp.$queryRawUnsafe(
        `SELECT * FROM ${BANG} WHERE "bat" = true AND "lanToi" IS NOT NULL AND "lanToi" <= (now() AT TIME ZONE 'UTC') ORDER BY "lanToi" ASC LIMIT 5`)
    const ra: string[] = []
    for (const r of den) {
        const lich = docDong(r)
        const lanCu: Date = new Date(r.lanToi)
        const keTiep = tinhLanToi(lich.tanSuat, bayGio)
        // Giành lượt: bản máy nào đổi được lanToi từ đúng giá trị cũ thì bản đó chạy
        const n = await sp.$executeRawUnsafe(
            `UPDATE ${BANG} SET "lanToi" = $2::timestamp(3), "updatedAt" = now() WHERE "id" = $1 AND "lanToi" = $3::timestamp(3)`,
            lich.id, gioUtc(keTiep), gioUtc(lanCu))
        if (!Number(n)) continue
        try {
            if (bayGio.getTime() - lanCu.getTime() > TRE_TOI_DA_MS) {
                const kq = `Lỡ lượt ${gioVN(lanCu)} (máy chủ không chạy đúng giờ) — chờ lượt ${gioVN(keTiep)}`
                await ghiKetQua(sp, lich.id, kq, null, bayGio)
                await baoBoLuot(sp, lich, kq, lanCu)
                ra.push(`${lich.id.slice(0, 6)}:lo-luot`)
                continue
            }
            const kq = await chayLich(sp, lich, { bayGio })
            ra.push(`${lich.id.slice(0, 6)}:${kq.boQua ? 'bo' : `+${kq.soNhom}`}`)
        } catch (e: any) {
            const loi = `Lỗi khi chạy lịch: ${String(e?.message || e).slice(0, 200)}`
            await ghiKetQua(sp, lich.id, loi, null, bayGio).catch(() => 0)
            await baoBoLuot(sp, lich, loi, bayGio)
            ra.push(`${lich.id.slice(0, 6)}:loi`)
        }
    }
    return ra.join(' ')
}
