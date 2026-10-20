/**
 * TỰ ĐỘNG ĐẨY HOÁ ĐƠN SANG MISA THEO GIỜ (chủ shop 20/10/2026: "đẩy hoá đơn, sẽ hiện theo ngày, cron tự động đẩy theo ngày giờ luôn")
 *
 * Thiết lập ở pushConfig.tuDong (services/misaPush.ts — CaiDatDay): bật, giờ chạy (giờ VN 'HH:MM'), phiếu của hôm qua / hôm nay,
 * chỉ phiếu Lấy HĐ. Nhịp ngoài /api/cron/tick gọi `nhipTuDongDayMisa` mỗi 5 phút. Mỗi cửa hàng, mỗi ngày MỘT lượt:
 *   1. tới giờ chưa, hôm nay chạy chưa (pushConfig.tuDongLan) — `denLuot`, hàm thuần có ca kiểm
 *   2. GIÀNH lượt bằng ghi so-rồi-ghi (capNhatCaiDat): Cloud Run nhiều bản máy, prod KHÔNG có Redis ⇒ loại trừ phải nằm trên dòng CSDL
 *   3. dựng kế hoạch như nút "Xem trước" rồi gửi mọi phiếu "Sẵn sàng" (guiDi) — y như bấm tay; phiếu đã đẩy tự đứng "Đã đẩy"
 *   4. ghi kết quả vào tuDongLan — trang "Đẩy HĐ sang MISA" hiện "Lần tự đẩy gần nhất"
 * Lượt đang chạy mà treo quá 20 phút (bản máy chết giữa chừng) thì nhịp sau được giành lại. Phiếu đã gửi đã vào sổ MisaPushItem nên
 * chạy lại không gửi trùng.
 *
 * org_refid băm từ CHUỖI SCHEMA: nhịp dùng Store.schema (registry), nút bấm tay dùng schema của phiên đăng nhập. Đo 20/10/2026 trên
 * HUTI: 23/23 phiếu đã đẩy khớp GUID băm bằng Store.schema (đối chứng sai một ký tự: 0/23) ⇒ hai đường ra cùng mã chứng từ.
 */
import { docCaiDat, docDanhMucMisa, lapKeHoach, guiDi, capNhatCaiDat, type CaiDatDay, type LanTuDong } from '../services/misaPush'
import type { MisaCreds } from '../services/misa'

/** Lượt "đang chạy" quá lâu coi như bản máy đã chết giữa chừng */
export const TREO_MS = 20 * 60_000

/** 'YYYY-MM-DD' + 'HH:MM' giờ VN của một thời điểm */
export function gioVN(d: Date): { ngay: string; gio: string } {
    const s = new Date(d.getTime() + 7 * 3600_000).toISOString()
    return { ngay: s.slice(0, 10), gio: s.slice(11, 16) }
}

/** Tới lượt tự đẩy chưa — HÀM THUẦN (scripts/check-misa-lien-ket.ts) */
export function denLuot(cd: CaiDatDay, now: Date): { duoc: boolean; lyDo: 'tat' | 'chua-den-gio' | 'da-chay' | 'dang-chay' | 'den-luot' } {
    if (!cd.tuDong.bat) return { duoc: false, lyDo: 'tat' }
    const { ngay, gio } = gioVN(now)
    if (gio < cd.tuDong.gio) return { duoc: false, lyDo: 'chua-den-gio' }
    const lan = cd.tuDongLan
    if (lan && lan.ngay === ngay) {
        if (lan.xong) return { duoc: false, lyDo: 'da-chay' }
        const tu = Date.parse(lan.batDau)
        if (Number.isFinite(tu) && now.getTime() - tu < TREO_MS) return { duoc: false, lyDo: 'dang-chay' }
    }
    return { duoc: true, lyDo: 'den-luot' }
}

/** Ngày bán của phiếu được đẩy: hôm qua hoặc hôm nay (giờ VN) */
export function khoangNgayPhieu(cd: CaiDatDay, now: Date): { ngay: string; tu: Date; den: Date } {
    const ngay = gioVN(new Date(now.getTime() - (cd.tuDong.ngay === 'hom_qua' ? 86400_000 : 0))).ngay
    return { ngay, tu: new Date(`${ngay}T00:00:00+07:00`), den: new Date(`${ngay}T23:59:59.999+07:00`) }
}

function credsOf(cfg: any): MisaCreds {
    return {
        appId: String(cfg.appId || '').trim(),
        accessCode: String(cfg.accessCode || '').trim(),
        orgCompanyCode: String(cfg.orgCompanyCode || '').trim(),
        baseUrl: cfg.baseUrl ? String(cfg.baseUrl).trim() : undefined,
        clientId: cfg.clientId ? String(cfg.clientId).trim() : undefined,
        clientSecret: cfg.clientSecret ? String(cfg.clientSecret).trim() : undefined,
    }
}

/** Phụ thuộc gọi MISA — ca kiểm thay bằng bản giả */
export interface PhuThuocTuDong {
    docDanhMuc: typeof docDanhMucMisa
    lapKeHoach: typeof lapKeHoach
    guiDi: typeof guiDi
}
const THAT: PhuThuocTuDong = { docDanhMuc: docDanhMucMisa, lapKeHoach, guiDi }

/** Một cửa hàng. Trả chuỗi ngắn cho nhịp; '' = không có việc (chưa bật / chưa tới giờ / đã chạy / bản máy khác đang chạy) */
export async function tuDongDayMotCuaHang(sp: any, schema: string, now = new Date(), pt: PhuThuocTuDong = THAT): Promise<string> {
    const cfg = await sp.misaConfig.findUnique({ where: { id: 'default' } })
        .catch((e: any) => { if (/MisaConfig|does not exist/i.test(String(e?.message))) return null; throw e })
    if (!cfg || !denLuot(docCaiDat(cfg.pushConfig), now).duoc) return ''

    const { ngay } = gioVN(now)
    const batDau = now.toISOString()
    // GIÀNH lượt: xét lại "tới lượt" trên bản VỪA ĐỌC trong cùng lần ghi có điều kiện ⇒ hai bản máy không cùng chạy
    const gianh = await capNhatCaiDat(sp, cu => (denLuot(cu, now).duoc ? { ...cu, tuDongLan: { ngay, batDau, xong: false } } : null))
    if (!gianh) return ''

    const kp = khoangNgayPhieu(gianh, now)
    const lan: LanTuDong = { ngay, batDau, xong: true, ngayPhieu: kp.ngay }
    try {
        const creds = credsOf(cfg)
        const dm = await pt.docDanhMuc(creds, schema)
        const kh = await pt.lapKeHoach(sp, creds, gianh, dm, {
            loai: 'banhang', tu: kp.tu, den: kp.den, schema, chiLayHoaDon: gianh.tuDong.chiLayHoaDon,
        })
        const sanSang = kh.dong.filter(d => d.trangThai === 'san_sang')
        lan.tong = kh.dong.length
        lan.sanSang = sanSang.length
        lan.thieu = kh.dem.thieu || 0
        lan.daGui = 0
        if (sanSang.length) {
            const kq = await pt.guiDi(sp, creds, 'banhang', sanSang)
            lan.daGui = kq.daGui
            lan.loi = kq.loi.length
            if (kq.loi.length) lan.ghiChu = kq.loi.slice(0, 3).map(l => `${l.refNo}: ${l.loi}`).join(' · ').slice(0, 300)
        } else if (kh.canhBaoChung.length) {
            lan.ghiChu = kh.canhBaoChung.join(' · ').slice(0, 300)
        }
    } catch (e: any) {
        lan.ghiChu = `Lỗi: ${String(e?.message || e).slice(0, 280)}`
    }
    lan.ketThuc = new Date().toISOString()
    // Chỉ đè kết quả của ĐÚNG lượt này; người dùng vừa lưu thiết lập giữa chừng thì capNhatCaiDat đọc lại, giữ thiết lập mới
    await capNhatCaiDat(sp, cu => (cu.tuDongLan?.batDau === batDau ? { ...cu, tuDongLan: lan } : null), 5)
    const tom = `${lan.daGui ?? 0}/${lan.sanSang ?? 0} phiếu${lan.loi ? `, ${lan.loi} lỗi` : ''}${lan.thieu ? `, ${lan.thieu} thiếu` : ''}`
    console.log(`[misa-tu-dong] ${schema} — phiếu ngày ${kp.ngay}: ${tom}${lan.ghiChu ? ` — ${lan.ghiChu}` : ''}`)
    return tom
}

/** Nhịp ngoài: mọi cửa hàng đang hoạt động, TUẦN TỰ (pool prod nhỏ, đừng Promise.all) — routes/cronTick.ts gọi mỗi 5 phút */
export async function nhipTuDongDayMisa(): Promise<string> {
    const { registryPrisma, getStorePrisma } = await import('./prisma')
    const stores: any[] = await (registryPrisma as any).store.findMany({ where: { status: 'active' }, select: { schema: true, code: true } })
    const ra: string[] = []
    for (const s of stores) {
        try {
            const kq = await tuDongDayMotCuaHang(getStorePrisma(s.schema) as any, s.schema)
            if (kq) ra.push(`${s.code}:${kq}`)
        } catch (e: any) { ra.push(`${s.code}:loi ${String(e?.message || e).slice(0, 80)}`) }
    }
    return ra.join(' ') || 'khong-co-gi'
}
