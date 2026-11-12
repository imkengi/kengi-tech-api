/**
 * THÔNG TIN PHÁP LÝ CỦA ĐƠN VỊ VẬN HÀNH KENGI TECH (12/11/2026).
 *
 * Trang /dieu-khoan và /chinh-sach-bao-mat (Luật BVDLCN 91/2025/QH15, Luật TMĐT 122/2025/QH15) phải nêu
 * ai là bên kiểm soát dữ liệu: tên, loại hình, MST, địa chỉ, người đại diện, đầu mối liên hệ, người phụ trách
 * bảo vệ dữ liệu cá nhân. Những thông tin đó CHỈ chủ shop biết ⇒ chủ shop tự điền ở kengi.vn/admin, tab
 * "Pháp lý"; trang pháp lý đọc qua GET /api/thong-tin-phap-ly (công khai — đây là thông tin vốn để công bố).
 *
 * ⛔ Không bao giờ tự điền/đoán giá trị: ô trống thì trang pháp lý hiện "đang cập nhật", không bịa.
 * Một dòng duy nhất trong bảng registry "public"."ThongTinPhapLy" (tự tạo lúc lưu lần đầu — đọc khi chưa
 * có bảng thì trả rỗng, KHÔNG tạo bảng từ đường công khai).
 */
import registryPrisma from './prisma'

const BANG = `"public"."ThongTinPhapLy"`

export const LOAI_HINH = ['ca-nhan', 'ho-kinh-doanh', 'doanh-nghiep'] as const

export const TRUONG_PHAP_LY = [
    'tenDonVi', 'loaiHinh', 'maSoThue', 'diaChi', 'nguoiDaiDien', 'chucVu',
    'email', 'dienThoai', 'nguoiPhuTrachDuLieu', 'emailPhuTrachDuLieu',
] as const
export type TruongPhapLy = typeof TRUONG_PHAP_LY[number]
export type ThongTinPhapLy = Record<TruongPhapLy, string> & { capNhatLuc: string | null }

const DAI_TOI_DA = 300

export function rongThongTin(): ThongTinPhapLy {
    const o: any = {}
    for (const k of TRUONG_PHAP_LY) o[k] = ''
    o.capNhatLuc = null
    return o
}

/** Chuẩn hoá dữ liệu gửi lên: chỉ nhận đúng các trường đã khai, chuỗi, cắt khoảng trắng, giới hạn độ dài.
 *  Trả lỗi (không ném) để route báo 400 rõ ràng. */
export function chuanHoaThongTin(vao: any): { ok: true; gt: Record<TruongPhapLy, string> } | { ok: false; loi: string } {
    if (!vao || typeof vao !== 'object' || Array.isArray(vao)) return { ok: false, loi: 'Dữ liệu phải là một đối tượng' }
    const gt: any = {}
    for (const k of TRUONG_PHAP_LY) {
        const v = vao[k]
        if (v === undefined || v === null) { gt[k] = ''; continue }
        if (typeof v !== 'string') return { ok: false, loi: `Trường ${k} phải là chuỗi` }
        const s = v.replace(/[\u0000-\u001f]/g, ' ').trim()
        if (s.length > DAI_TOI_DA) return { ok: false, loi: `Trường ${k} dài quá ${DAI_TOI_DA} ký tự` }
        gt[k] = s
    }
    if (gt.loaiHinh && !(LOAI_HINH as readonly string[]).includes(gt.loaiHinh)) return { ok: false, loi: 'Loại hình không hợp lệ' }
    if (gt.maSoThue && !/^\d{10}(-\d{3})?$|^\d{12}$/.test(gt.maSoThue)) return { ok: false, loi: 'Mã số thuế phải là 10 số, 10 số-3 số, hoặc 12 số (mã định danh cá nhân)' }
    for (const k of ['email', 'emailPhuTrachDuLieu'] as const) {
        if (gt[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gt[k])) return { ok: false, loi: `${k === 'email' ? 'Email liên hệ' : 'Email người phụ trách dữ liệu'} không hợp lệ` }
    }
    return { ok: true, gt }
}

async function coBang(): Promise<boolean> {
    const r: any[] = await registryPrisma.$queryRawUnsafe(`SELECT to_regclass('public."ThongTinPhapLy"') IS NOT NULL AS co`)
    return !!r[0]?.co
}

/** Đọc — chưa có bảng / chưa lưu lần nào ⇒ trả rỗng. Lỗi CSDL khác thì NÉM (đọc hỏng ≠ "chưa điền"). */
export async function docThongTinPhapLy(): Promise<ThongTinPhapLy> {
    if (!(await coBang())) return rongThongTin()
    const r: any[] = await registryPrisma.$queryRawUnsafe(`SELECT "duLieu", "capNhatLuc" FROM ${BANG} WHERE "id" = 'default'`)
    if (!r[0]) return rongThongTin()
    const o = rongThongTin()
    let d: any = {}
    try { d = JSON.parse(r[0].duLieu || '{}') } catch { d = {} }
    for (const k of TRUONG_PHAP_LY) if (typeof d[k] === 'string') o[k] = d[k]
    o.capNhatLuc = r[0].capNhatLuc ? new Date(r[0].capNhatLuc).toISOString() : null
    return o
}

export async function luuThongTinPhapLy(gt: Record<TruongPhapLy, string>): Promise<ThongTinPhapLy> {
    await registryPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${BANG} (
        "id" TEXT PRIMARY KEY DEFAULT 'default',
        "duLieu" TEXT NOT NULL,
        "capNhatLuc" TIMESTAMP(3) NOT NULL DEFAULT now()
    )`)
    await registryPrisma.$executeRawUnsafe(
        `INSERT INTO ${BANG} ("id", "duLieu", "capNhatLuc") VALUES ('default', $1, now())
         ON CONFLICT ("id") DO UPDATE SET "duLieu" = EXCLUDED."duLieu", "capNhatLuc" = now()`, JSON.stringify(gt))
    return docThongTinPhapLy()
}
