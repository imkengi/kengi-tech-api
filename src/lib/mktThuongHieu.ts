/**
 * THƯƠNG HIỆU của Marketing Studio — 29/09/2026
 * Chuyển từ `scratch/fanpage-dashboard/marketing` (server.js + schemas.js).
 *
 * Một cửa hàng làm marketing cho tối đa MAX_THUONG_HIEU thương hiệu. Mỗi thương hiệu
 * tách hẳn: kênh, chiến dịch, bài, media. Lý do tách chứ không chỉ "gắn nhãn": AI viết
 * content cho thương hiệu A tuyệt đối không được thấy sản phẩm/giá của thương hiệu B.
 *
 * Hồ sơ thương hiệu là NGUỒN SỰ THẬT cho AI: ô trống nghĩa là KHÔNG BIẾT, không phải
 * "cứ bịa cho hợp lý". Vì vậy hồ sơ luôn trả ĐỦ trường (trống = "") để AI thấy rõ trống.
 */
import { Response, NextFunction } from 'express'
import { AuthRequest } from '../middleware/auth'
import { errMsg } from './errorResponse'
import { chuanKhungGio } from './mktKhungGio'

export const MAX_THUONG_HIEU = 10

/** Lỗi có thông điệp DÀNH CHO NGƯỜI DÙNG — trả nguyên văn, không bị nuốt thành 500. */
export class LoiMkt extends Error {
    constructor(message: string, public status = 400, public code = 'MKT_LOI') {
        super(message)
        this.name = 'LoiMkt'
    }
}

/** Trả lỗi ra HTTP. Lỗi lạ thì LOG rồi mới giấu — route nuốt lỗi không log từng tốn cả giờ truy. */
export function traLoi(res: Response, err: any, noi = 'mkt') {
    if (err instanceof LoiMkt) return res.status(err.status).json({ success: false, error: err.message, code: err.code })
    console.error(`[${noi}]`, err?.message || err)
    return res.status(500).json({ success: false, error: errMsg(err) })
}

// ─── Hồ sơ ───────────────────────────────────────────────────────────────────
const TRUONG_CHU = [
    'name', 'industry', 'description', 'products', 'contentPillars', 'contact',
    'audience', 'voice', 'usp', 'cta', 'examples', 'notes', 'timezone',
] as const

/** Bản ghi DB → hồ sơ trả ra ngoài (bannedWords là mảng thật, không phải chuỗi JSON). */
export function hoSo(b: any) {
    if (!b) return b
    let cam: string[] = []
    try {
        const v = JSON.parse(String(b.bannedWords || '[]'))
        if (Array.isArray(v)) cam = v.map(String)
    } catch { /* hồ sơ hỏng JSON thì coi như chưa khai từ cấm, không làm sập cả trang */ }
    const ra: any = { id: b.id }
    for (const k of TRUONG_CHU) ra[k] = b[k] ?? ''
    ra.bannedWords = cam
    ra.aiAutoApprove = b.aiAutoApprove === true
    ra.postSlots = b.postSlots ?? ''
    return ra
}

/**
 * Kiểm một BẢN VÁ hồ sơ: chỉ các trường được gửi mới đổi. Trường lạ bị từ chối
 * (gõ nhầm tên trường mà im lặng bỏ qua thì người ta tưởng đã lưu).
 */
export function kiemBanVaHoSo(body: any): Record<string, any> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LoiMkt('Hồ sơ phải là một đối tượng JSON.')
    const data: Record<string, any> = {}
    for (const [k, v] of Object.entries(body)) {
        if (k === 'bannedWords') {
            if (!Array.isArray(v) || v.length > 100 || v.some(x => typeof x !== 'string' || !x.trim() || x.length > 100))
                throw new LoiMkt('bannedWords phải là mảng tối đa 100 từ, mỗi từ 1–100 ký tự.')
            data.bannedWords = JSON.stringify(v.map(x => x.trim()))
            continue
        }
        if (k === 'postSlots') {
            const khung = typeof v === 'string' ? chuanKhungGio(v) : null
            if (khung === null) throw new LoiMkt('Khung giờ đăng chưa đọc được giờ nào — ví dụ: 08:00, 12:00, 20:00.')
            data.postSlots = khung
            continue
        }
        if (!(TRUONG_CHU as readonly string[]).includes(k)) throw new LoiMkt(`Trường "${k}" không có trong hồ sơ thương hiệu.`)
        if (typeof v !== 'string') throw new LoiMkt(`Trường "${k}" phải là chuỗi.`)
        const s = v.trim()
        if (k === 'name' && (!s || s.length > 120)) throw new LoiMkt('Tên thương hiệu phải từ 1 đến 120 ký tự.')
        if (s.length > 10000) throw new LoiMkt(`Trường "${k}" dài quá 10.000 ký tự.`)
        if (k === 'timezone') {
            try { new Intl.DateTimeFormat('en', { timeZone: s }) } catch { throw new LoiMkt('Múi giờ không hợp lệ.') }
        }
        data[k] = s
    }
    return data
}

// ─── Thương hiệu đầu tiên ────────────────────────────────────────────────────
/* Những cửa hàng đã được "quét" dòng brandId NULL trong tiến trình này — quét một lần
 * mỗi lần khởi động là đủ, khỏi tốn 4 câu UPDATE mỗi request (pool prod 1 kết nối/cửa hàng). */
const daQuet = new Set<string>()

const GIONG_CU: Record<string, string> = {
    'than-thien': 'Thân thiện, gần gũi',
    'chuyen-nghiep': 'Chuyên nghiệp, đáng tin',
    'hai-huoc': 'Hài hước, dí dỏm',
    'sang-trong': 'Sang trọng, tinh tế',
}

/**
 * Danh sách thương hiệu đang dùng (cũ nhất trước). Cửa hàng chưa có thương hiệu nào thì
 * DỰNG thương hiệu đầu tiên từ hồ sơ Content AI cũ (FbBrandProfile) — người đã khai hồ
 * sơ ở fanpage-manager không phải khai lại — rồi gán mọi dòng Mkt* chưa có chủ vào nó.
 */
export async function dsThuongHieu(prisma: any, khoa: string, tenMacDinh = 'Thương hiệu của tôi'): Promise<any[]> {
    let ds = await prisma.mktBrand.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } })
    if (!ds.length) {
        const cu = await prisma.fbBrandProfile.findFirst().catch(() => null)
        let cam = '[]'
        try { if (Array.isArray(JSON.parse(cu?.bannedWords || '[]'))) cam = cu.bannedWords } catch { }
        const dau = await prisma.mktBrand.create({
            data: {
                name: (cu?.brandName || '').trim() || tenMacDinh,
                industry: cu?.industry || '',
                audience: cu?.audience || '',
                voice: GIONG_CU[cu?.toneOfVoice] || '',
                usp: cu?.usp || '',
                cta: cu?.cta || '',
                notes: cu?.notes || '',
                bannedWords: cam,
            },
        })
        ds = [dau]
        daQuet.delete(khoa)
    }
    if (!daQuet.has(khoa)) {
        const dau = ds[0].id
        for (const bang of ['mktAccount', 'mktCampaign', 'mktContent', 'mktAsset'])
            await prisma[bang].updateMany({ where: { brandId: null }, data: { brandId: dau } })
        daQuet.add(khoa)
    }
    return ds
}

export interface MktRequest extends AuthRequest {
    mktBrand?: any
    mktBrands?: any[]
}

/**
 * Middleware: gắn `req.mktBrand` = thương hiệu đang làm việc (header `x-mkt-brand`,
 * hoặc `?brand=` cho link tải file). Không gửi thì lấy thương hiệu đầu tiên. Gửi id
 * không thuộc cửa hàng / đã xoá thì 404 — KHÔNG lặng lẽ rơi về thương hiệu khác, vì
 * như thế người ta sửa nhầm dữ liệu của thương hiệu khác mà không hay.
 */
/** Dấu `approvedBy` của bài do AI tự duyệt — worker và giao diện nhận ra bằng dấu này. */
export const AI_TU_DUYET = 'ai:tu-duyet'

export async function chonThuongHieu(req: MktRequest, res: Response, next: NextFunction) {
    try {
        const prisma: any = req.storePrisma
        const khoa = req.user?.branchSchema || req.user?.storeSchema || req.user?.storeCode || '?'
        const ds = await dsThuongHieu(prisma, khoa)
        const muon = String(req.headers['x-mkt-brand'] || (req.query as any)?.brand || '').trim()
        const chon = muon ? ds.find(b => b.id === muon) : ds[0]
        if (!chon) throw new LoiMkt('Không tìm thấy thương hiệu (có thể đã bị xoá).', 404, 'BRAND_NOT_FOUND')
        req.mktBrand = chon
        req.mktBrands = ds
        next()
    } catch (err) { traLoi(res, err, 'mkt/thuong-hieu') }
}
