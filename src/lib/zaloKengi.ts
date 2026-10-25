/**
 * ZALO CÁ NHÂN ĐĂNG NHẬP NGAY TRONG KENGI — QUÉT QR, GỬI TIN NHÓM, QUÉT NHÓM (25/10/2026)
 *
 * Chủ shop: "hay m viết mẹ cái đăng nhập zalo trong đó luôn đi". Trước đây mọi việc với Zalo đi qua
 * node Zalo của n8n (lib/zaloGui.ts). Phiên đăng nhập trong n8n hết hạn thì webhook chỉ trả "Workflow
 * execution failed", lý do thật ("zpw_sek bị thiếu hoặc không đúng") phải mở n8n mới thấy. Nay Kengi
 * tự giữ phiên bằng zca-js — API KHÔNG chính thức, đăng nhập như một trình duyệt mở chat.zalo.me:
 *
 *  - QUÉT QR TRONG MỘT REQUEST: POST /api/zalo/dang-nhap/qr trả luồng sự kiện (SSE): mã QR → đã quét →
 *    xong. KHÔNG tách "lấy mã" + "hỏi trạng thái": Cloud Run chỉ cấp CPU khi đang có request
 *    (cpu-throttling) và chạy nhiều bản máy — lượt hỏi rơi sang máy khác là không thấy phiên đang chờ.
 *  - PHIÊN LƯU MÃ HOÁ: bảng ZaloPhien (schema cửa hàng, tạo lười) giữ cookie + imei + userAgent qua
 *    AES-GCM (lib/maHoaKhoa). Có ba thứ đó là dùng được Zalo công ty ⇒ KHÔNG BAO GIỜ trả ra màn hình,
 *    không ghi log.
 *  - Mỗi bản máy giữ API đã đăng nhập trong bộ nhớ; phiên đổi (quét lại) thì nhận ra qua `phienSo`.
 *    Zalo cấp cookie mới trong lúc dùng (set-cookie) ⇒ ghi lại sau mỗi lần dùng cho bản lưu khỏi cũ dần.
 *  - PHIÊN CHẾT: gặp lỗi Zalo thì đăng nhập lại từ bản lưu + đọc hồ sơ; hỏng nữa mới kết luận hết hạn —
 *    một tin lỗi vì nhóm đã giải tán không được làm "mất phiên". Lỗi mạng / HTTP 5xx không kết luận gì.
 *    Hết hạn ⇒ trangThai 'het_han' + báo chuông MỘT lần; hàng đợi gửi TẠM DỪNG (lib/zaloGui.ts), quét
 *    QR lại là gửi tiếp.
 *
 * ⚠ Zalo có thể khoá tài khoản gửi dồn — nhịp giãn vẫn ở lib/zaloGui.ts (guiMoiPhut).
 */

import crypto from 'crypto'
import { Zalo, ThreadType, LoginQRCallbackEventType, ZaloApiError, type API } from 'zca-js'
import { maHoa, giaiMa } from './maHoaKhoa'

const BANG = '"ZaloPhien"'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
/** zca-js mặc định BẬT checkUpdate (gọi registry npm mỗi lần đăng nhập) và logging (in uid ra log) */
const TUY_CHON = { selfListen: false, checkUpdate: false, logging: false }
/** zca-js tự huỷ mã QR sau 100 giây (apis/loginQR.cjs) */
export const QR_SONG_GIAY = 100
/** Đã đăng nhập lại thành công trong khoảng này thì lỗi gửi KHÔNG kích hoạt kiểm phiên thêm lần nữa —
 *  một đợt 30 nhóm lỗi "không còn trong nhóm" không được thành 30 lần đăng nhập Zalo. */
const KIEM_LAI_SAU_MS = 5 * 60_000
const CAU_HET_HAN = 'Phiên Zalo trong Kengi đã hết hạn — quét lại mã QR ở Chăm Sóc Khách Hàng › Đăng nhập Zalo'

const moTa = (e: any) => String(e?.message || e || 'lỗi không rõ').replace(/\s+/g, ' ').slice(0, 200)
const nghi = (ms: number) => new Promise(r => setTimeout(r, ms))

export class LoiPhienZalo extends Error {
    constructor(message: string) { super(message); this.name = 'LoiPhienZalo' }
}

/** Lỗi do Zalo trả về (ZaloApiError của zca-js) — khác lỗi mạng / lỗi máy mình */
export function laLoiZalo(e: any): boolean {
    return !!e && (e instanceof ZaloApiError || e?.name === 'ZcaApiError')
}

/** Lỗi Zalo nhưng là trục trặc đường truyền / máy chủ Zalo (HTTP 5xx, 429) — không kết luận phiên chết */
export function laLoiTamThoi(e: any): boolean {
    return /status code (5\d\d|429)|Failed to fetch login info|Service Unavailable|Bad Gateway|Gateway Time-?out|Too Many Requests/i.test(String(e?.message || ''))
}

// ─── Bảng ZaloPhien (tạo lười — cùng nếp services/hoaDonXmlEmail.ts) ─────────

const daTaoBang = new Set<string>()

export async function tenSchema(sp: any): Promise<string> {
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
            "duLieu" TEXT NOT NULL,
            "phienSo" TEXT NOT NULL,
            "uid" TEXT, "ten" TEXT, "anh" TEXT,
            "trangThai" TEXT NOT NULL DEFAULT 'song',
            "loiCuoi" TEXT,
            "nguoiDangNhap" TEXT,
            "dangNhapLuc" TIMESTAMP(3) NOT NULL DEFAULT now(),
            "dungLuc" TIMESTAMP(3),
            "giuLuc" TIMESTAMP(3),
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
        )`)
    } catch (e: any) {
        // Hai bản máy cùng tạo một lúc: Postgres có thể ném trùng dù có IF NOT EXISTS
        if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
    }
    daTaoBang.add(schema)
}

/** Có bảng chưa — nhịp nền dùng cái này để KHÔNG tạo bảng ở mọi cửa hàng */
async function coBang(sp: any): Promise<boolean> {
    if (daTaoBang.has(await tenSchema(sp))) return true
    const r: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('"ZaloPhien"') IS NOT NULL AS co`)
    return !!r[0]?.co
}

interface DongPhien {
    duLieu: string; phienSo: string; uid: string | null; ten: string | null; anh: string | null
    trangThai: string; loiCuoi: string | null; nguoiDangNhap: string | null
    dangNhapLuc: Date; dungLuc: Date | null; giuLuc: Date | null
}

async function docDong(sp: any): Promise<DongPhien | null> {
    const r: any[] = await sp.$queryRawUnsafe(`SELECT * FROM ${BANG} WHERE "id" = 'default'`)
    return r[0] || null
}

// ─── Phiên trong bộ nhớ ──────────────────────────────────────────────────────

export interface ThongTinDangNhap { cookie: any[]; imei: string; userAgent: string }
export interface PhienNho { api: API; phienSo: string; tt: ThongTinDangNhap; bam: string; kiemLuc: number }
const boNho = new Map<string, PhienNho>()

/** Dấu của bộ cookie — chỉ khoá/giá trị/hạn; bỏ lastAccessed/creation (đổi sau MỖI request) */
export function bamCookie(cookie: any[]): string {
    const goc = (Array.isArray(cookie) ? cookie : [])
        .map((c: any) => `${c?.domain || ''}|${c?.path || ''}|${c?.key || c?.name || ''}=${c?.value || ''}|${c?.expires || ''}`)
        .sort().join('\n')
    return crypto.createHash('sha256').update(goc).digest('hex')
}

function docThongTin(duLieu: string): ThongTinDangNhap {
    const tt = JSON.parse(giaiMa(duLieu))
    if (!tt?.imei || !Array.isArray(tt?.cookie) || !tt?.userAgent) throw new Error('Phiên Zalo đã lưu bị hỏng')
    return tt
}

function cookieHienTai(api: API): any[] | null {
    try {
        const c = (api.getCookie() as any)?.toJSON?.()?.cookies
        return Array.isArray(c) && c.length ? c : null
    } catch { return null }
}

/** Báo chuông + đẩy thông báo MỘT lần cho mỗi phiên (dấu theo phienSo) — cùng cách lib/henGioDangVideo.ts */
async function baoHetHan(sp: any, phienSo: string): Promise<void> {
    try {
        const dau = `[zalo-het-han:${phienSo.slice(0, 12)}]`
        const da = await sp.notification.findFirst({ where: { message: { contains: dau } }, select: { id: true } })
        if (da) return
        const tieuDe = 'Zalo trong Kengi đã bị đăng xuất'
        const noiDung = 'Phiên đăng nhập Zalo hết hạn nên tin nhắn nhóm đang TẠM DỪNG. Vào Khách Hàng › Chăm Sóc Khách Hàng, quét lại mã QR là gửi tiếp.'
        const tin = await sp.notification.create({ data: { type: 'warning', title: tieuDe, message: `${noiDung} ${dau}` } })
        const { sendPushToStore } = await import('../routes/notifications')
        await sendPushToStore(sp, tieuDe, noiDung, { id: tin?.id, type: 'warning' })
    } catch (e: any) {
        console.warn(`[zalo-kengi] không gửi được thông báo hết hạn — ${moTa(e)}`)
    }
}

/** Đánh dấu phiên chết — CHỈ phiên đang sống và đúng phienSo (máy cũ lỗi không được giết phiên vừa quét lại) */
async function danhDauHetHan(sp: any, phienSo: string, loi: string): Promise<void> {
    boNho.delete(await tenSchema(sp))
    const n = await sp.$executeRawUnsafe(
        `UPDATE ${BANG} SET "trangThai" = 'het_han', "loiCuoi" = $1, "updatedAt" = now()
         WHERE "id" = 'default' AND "phienSo" = $2 AND "trangThai" = 'song'`, loi.slice(0, 500), phienSo)
    if (Number(n) > 0) await baoHetHan(sp, phienSo)
}

/** Dùng xong: ghi lại cookie nếu Zalo đã cấp bộ mới, đóng dấu lần dùng cuối. Lỗi ghi không làm hỏng việc vừa xong. */
async function ghiLaiSauKhiDung(sp: any, p: PhienNho): Promise<void> {
    try {
        const cookie = cookieHienTai(p.api)
        const bam = cookie ? bamCookie(cookie) : p.bam
        if (cookie && bam !== p.bam) {
            const tt = { ...p.tt, cookie }
            await sp.$executeRawUnsafe(
                `UPDATE ${BANG} SET "duLieu" = $1, "dungLuc" = now(), "updatedAt" = now() WHERE "id" = 'default' AND "phienSo" = $2`,
                maHoa(JSON.stringify(tt)), p.phienSo)
            p.tt = tt
            p.bam = bam
        } else {
            await sp.$executeRawUnsafe(`UPDATE ${BANG} SET "dungLuc" = now() WHERE "id" = 'default' AND "phienSo" = $1`, p.phienSo)
        }
    } catch (e: any) {
        console.warn(`[zalo-kengi] không ghi lại được phiên sau khi dùng — ${moTa(e)}`)
    }
}

async function dangNhapTuBanLuu(sp: any, d: DongPhien): Promise<PhienNho> {
    let tt: ThongTinDangNhap
    try { tt = docThongTin(d.duLieu) } catch (e: any) {
        // Không giải mã được (khoá vault đổi / bản lưu hỏng) thì quét lại là cách duy nhất
        await danhDauHetHan(sp, d.phienSo, `Không đọc được phiên đã lưu (${moTa(e)})`)
        throw new LoiPhienZalo(CAU_HET_HAN)
    }
    try {
        const api = await new Zalo(TUY_CHON).login({ cookie: tt.cookie, imei: tt.imei, userAgent: tt.userAgent, language: 'vi' })
        const p: PhienNho = { api, phienSo: d.phienSo, tt, bam: bamCookie(tt.cookie), kiemLuc: Date.now() }
        boNho.set(await tenSchema(sp), p)
        return p
    } catch (e: any) {
        if (!laLoiZalo(e) || laLoiTamThoi(e)) throw e
        await danhDauHetHan(sp, d.phienSo, `Zalo không nhận phiên đã lưu: ${moTa(e)}`)
        throw new LoiPhienZalo(CAU_HET_HAN)
    }
}

/** API đã đăng nhập của cửa hàng. Ném LoiPhienZalo khi chưa đăng nhập / phiên chết; lỗi khác = trục trặc tạm. */
export async function layApi(sp: any): Promise<PhienNho> {
    await damBaoBang(sp)
    const schema = await tenSchema(sp)
    const d = await docDong(sp)
    if (!d) { boNho.delete(schema); throw new LoiPhienZalo('Chưa đăng nhập Zalo trong Kengi — quét mã QR ở Chăm Sóc Khách Hàng › Đăng nhập Zalo') }
    if (d.trangThai !== 'song') { boNho.delete(schema); throw new LoiPhienZalo(CAU_HET_HAN) }
    const nho = boNho.get(schema)
    if (nho && nho.phienSo === d.phienSo) return nho
    return dangNhapTuBanLuu(sp, d)
}

// ─── Trạng thái cho màn hình (KHÔNG BAO GIỜ có cookie) ──────────────────────

export interface TrangThaiPhien {
    coPhien: boolean
    trangThai: 'song' | 'het_han' | null
    uid: string | null; ten: string | null; anh: string | null
    loiCuoi: string | null; nguoiDangNhap: string | null
    dangNhapLuc: Date | null; dungLuc: Date | null; giuLuc: Date | null
}

const CHUA_CO: TrangThaiPhien = {
    coPhien: false, trangThai: null, uid: null, ten: null, anh: null, loiCuoi: null, nguoiDangNhap: null,
    dangNhapLuc: null, dungLuc: null, giuLuc: null,
}

export async function docTrangThai(sp: any): Promise<TrangThaiPhien> {
    await damBaoBang(sp)
    const d = await docDong(sp)
    if (!d) return { ...CHUA_CO }
    return {
        coPhien: true, trangThai: d.trangThai === 'song' ? 'song' : 'het_han',
        uid: d.uid, ten: d.ten, anh: d.anh, loiCuoi: d.loiCuoi, nguoiDangNhap: d.nguoiDangNhap,
        dangNhapLuc: d.dangNhapLuc, dungLuc: d.dungLuc, giuLuc: d.giuLuc,
    }
}

/**
 * Đăng nhập MỚI từ bản lưu + đọc hồ sơ. song: true = sống, false = chết (đã đánh dấu), null = không rõ
 * (lỗi mạng). `hoiSinh`: thử cả phiên đang đánh dấu hết hạn — nút "Kiểm tra lại" cứu được lần kết luận nhầm.
 */
export async function kiemTraPhien(sp: any, hoiSinh = false): Promise<{ song: boolean | null; loi: string | null }> {
    await damBaoBang(sp)
    const d = await docDong(sp)
    if (!d) return { song: false, loi: 'Chưa đăng nhập Zalo trong Kengi' }
    if (d.trangThai !== 'song' && !hoiSinh) return { song: false, loi: d.loiCuoi || CAU_HET_HAN }
    boNho.delete(await tenSchema(sp))
    if (d.trangThai !== 'song') {
        // Hồi sinh: cho dòng về 'song' trước, đăng nhập hỏng thì danhDauHetHan đánh dấu lại như cũ
        await sp.$executeRawUnsafe(`UPDATE ${BANG} SET "trangThai" = 'song' WHERE "id" = 'default' AND "phienSo" = $1`, d.phienSo)
    }
    try {
        const p = await dangNhapTuBanLuu(sp, { ...d, trangThai: 'song' })
        const hs: any = (await p.api.fetchAccountInfo())?.profile || {}
        await sp.$executeRawUnsafe(
            `UPDATE ${BANG} SET "trangThai" = 'song', "loiCuoi" = NULL, "ten" = COALESCE($1, "ten"), "anh" = COALESCE($2, "anh"),
             "uid" = COALESCE($3, "uid"), "updatedAt" = now() WHERE "id" = 'default' AND "phienSo" = $4`,
            hs.displayName || hs.zaloName || null, hs.avatar || null, hs.userId ? String(hs.userId) : null, d.phienSo)
        await ghiLaiSauKhiDung(sp, p)
        return { song: true, loi: null }
    } catch (e: any) {
        if (e instanceof LoiPhienZalo) return { song: false, loi: e.message }
        if (laLoiZalo(e) && !laLoiTamThoi(e)) {
            await danhDauHetHan(sp, d.phienSo, `Zalo không nhận phiên đã lưu: ${moTa(e)}`)
            return { song: false, loi: moTa(e) }
        }
        if (d.trangThai !== 'song') {
            // Hồi sinh mà gặp lỗi mạng: trả về trạng thái cũ, đừng để phiên "sống" mà chưa ai chứng minh
            await sp.$executeRawUnsafe(`UPDATE ${BANG} SET "trangThai" = 'het_han' WHERE "id" = 'default' AND "phienSo" = $1`, d.phienSo).catch(() => 0)
        }
        return { song: null, loi: moTa(e) }
    }
}

/** Đăng xuất = QUÊN phiên trong Kengi (zca-js không có lệnh đăng xuất; phiên web trên Zalo tự hết hạn,
 *  hoặc chủ shop đăng xuất thiết bị trong mục quản lý đăng nhập của Zalo trên điện thoại). */
export async function dangXuat(sp: any): Promise<boolean> {
    await damBaoBang(sp)
    boNho.delete(await tenSchema(sp))
    const n = await sp.$executeRawUnsafe(`DELETE FROM ${BANG} WHERE "id" = 'default'`)
    return Number(n) > 0
}

// ─── Quét QR ────────────────────────────────────────────────────────────────

export type SuKienQR =
    | { loai: 'qr'; anh: string; giay: number }
    | { loai: 'da_quet'; ten: string | null; anh: string | null }
    | { loai: 'het_han' }
    | { loai: 'tu_choi' }
    | { loai: 'xong'; ten: string | null; uid: string | null; anh: string | null; doiTaiKhoan: boolean }
    | { loai: 'loi'; loi: string }

/**
 * Cả quá trình quét QR trong MỘT lời gọi: phat() đẩy từng sự kiện ra luồng SSE. `huy` = trình duyệt đóng
 * kết nối ⇒ dừng chờ quét. Quét + xác nhận xong thì LƯU dù trình duyệt đã đóng — người dùng đã bấm đăng
 * nhập trên điện thoại, đó là ý của họ.
 */
export async function dangNhapQR(sp: any, nguoi: string | null, phat: (s: SuKienQR) => void, huy: AbortSignal): Promise<void> {
    await damBaoBang(sp)
    const schema = await tenSchema(sp)
    // Gán trong callback ⇒ để trong một object (TypeScript không theo dõi phép gán trong closure)
    const giu: { thaoTac: { abort?: () => void } | null; daKetThuc: boolean; tt: ThongTinDangNhap | null; quet: { ten: string | null; anh: string | null } } =
        { thaoTac: null, daKetThuc: false, tt: null, quet: { ten: null, anh: null } }
    const dung = () => { giu.daKetThuc = true; try { giu.thaoTac?.abort?.() } catch { /* đã dừng */ } }
    huy.addEventListener('abort', dung, { once: true })
    // Chốt an toàn: mã QR sống 100 giây, xác nhận xong chỉ còn vài lời gọi — quá 3 phút là Zalo treo,
    // đừng giữ request tới hạn 15 phút của Cloud Run
    let henGio: ReturnType<typeof setTimeout> | undefined
    const quaGio = new Promise<never>((_, reject) => {
        henGio = setTimeout(() => { reject(new Error('Quá 3 phút Zalo chưa trả lời — bấm tạo mã mới')) }, 180_000)
    })
    let api: API
    try {
        api = await Promise.race([quaGio, new Zalo(TUY_CHON).loginQR({ userAgent: UA, language: 'vi' }, (e: any) => {
            if (e?.actions) giu.thaoTac = e.actions
            if (huy.aborted) { dung(); return }
            switch (e?.type) {
                case LoginQRCallbackEventType.QRCodeGenerated:
                    phat({ loai: 'qr', anh: `data:image/png;base64,${String(e.data?.image || '')}`, giay: QR_SONG_GIAY })
                    break
                case LoginQRCallbackEventType.QRCodeScanned:
                    giu.quet = { ten: e.data?.display_name || null, anh: e.data?.avatar || null }
                    phat({ loai: 'da_quet', ...giu.quet })
                    break
                case LoginQRCallbackEventType.QRCodeExpired:
                    if (!giu.daKetThuc) phat({ loai: 'het_han' })
                    dung()
                    break
                case LoginQRCallbackEventType.QRCodeDeclined:
                    if (!giu.daKetThuc) phat({ loai: 'tu_choi' })
                    dung()   // bị từ chối thì zca-js KHÔNG tự kết thúc — không gọi abort là request treo mãi
                    break
                case LoginQRCallbackEventType.GotLoginInfo:
                    giu.tt = { cookie: Array.isArray(e.data?.cookie) ? e.data.cookie : [], imei: String(e.data?.imei || ''), userAgent: String(e.data?.userAgent || UA) }
                    break
            }
        })])
    } catch (e: any) {
        if (!giu.daKetThuc) phat({ loai: 'loi', loi: laLoiZalo(e) ? `Zalo: ${moTa(e)}` : moTa(e) })
        dung()
        return
    } finally {
        clearTimeout(henGio)
        huy.removeEventListener('abort', dung)
    }
    if (!giu.tt?.imei) { phat({ loai: 'loi', loi: 'Zalo không trả thông tin đăng nhập — thử quét lại' }); return }
    const tt: ThongTinDangNhap = { ...giu.tt, cookie: cookieHienTai(api) || giu.tt.cookie }
    let hs: any = {}
    try { hs = (await api.fetchAccountInfo())?.profile || {} } catch { /* hồ sơ chỉ để hiện tên, không bắt buộc */ }
    let uidMinh: string | null = null
    try { uidMinh = String(api.getOwnId() || '') || null } catch { /* không có thì thôi */ }
    const uid = hs.userId ? String(hs.userId) : uidMinh
    const ten = hs.displayName || hs.zaloName || giu.quet.ten || null
    const anh = hs.avatar || giu.quet.anh || null
    let duLieu: string
    try { duLieu = maHoa(JSON.stringify(tt)) } catch (e: any) { phat({ loai: 'loi', loi: `Không mã hoá được phiên để lưu: ${moTa(e)}` }); return }
    const cu = await docDong(sp)
    const phienSo = crypto.randomUUID()
    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG} ("id", "duLieu", "phienSo", "uid", "ten", "anh", "trangThai", "loiCuoi", "nguoiDangNhap", "dangNhapLuc", "dungLuc", "giuLuc", "updatedAt")
         VALUES ('default', $1, $2, $3, $4, $5, 'song', NULL, $6, now(), now(), now(), now())
         ON CONFLICT ("id") DO UPDATE SET "duLieu" = EXCLUDED."duLieu", "phienSo" = EXCLUDED."phienSo", "uid" = EXCLUDED."uid",
            "ten" = EXCLUDED."ten", "anh" = EXCLUDED."anh", "trangThai" = 'song', "loiCuoi" = NULL, "nguoiDangNhap" = EXCLUDED."nguoiDangNhap",
            "dangNhapLuc" = now(), "dungLuc" = now(), "giuLuc" = now(), "updatedAt" = now()`,
        duLieu, phienSo, uid, ten, anh, nguoi)
    boNho.set(schema, { api, phienSo, tt, bam: bamCookie(tt.cookie), kiemLuc: Date.now() })
    phat({ loai: 'xong', ten, uid, anh, doiTaiKhoan: !!(cu?.uid && uid && cu.uid !== uid) })
}

// ─── Gửi tin + quét nhóm ────────────────────────────────────────────────────

export interface AnhGui { data: Buffer; ten: string; rong?: number; cao?: number }
export interface KetQuaGuiZalo { ok: boolean; loi: string | null; matPhien: boolean }

/** Gửi MỘT tin (đã điền mẫu) vào MỘT nhóm. 1 ảnh + chữ ⇒ chữ thành chú thích ảnh; nhiều ảnh ⇒ chữ trước, album sau. */
export async function guiTinNhom(sp: any, groupId: string, noiDung: string, anh: AnhGui[] = []): Promise<KetQuaGuiZalo> {
    let p: PhienNho
    try { p = await layApi(sp) } catch (e: any) {
        if (e instanceof LoiPhienZalo) return { ok: false, loi: e.message, matPhien: true }
        return { ok: false, loi: `Không kết nối được Zalo: ${moTa(e)}`, matPhien: false }
    }
    try {
        await p.api.sendMessage({
            msg: String(noiDung || ''),   // PHẢI là chuỗi — zca-js đọc msg.length kể cả khi chỉ gửi ảnh
            attachments: anh.map(a => ({
                data: a.data, filename: a.ten as `${string}.${string}`,
                metadata: { totalSize: a.data.length, width: a.rong, height: a.cao },
            })),
        }, String(groupId), ThreadType.Group)
        await ghiLaiSauKhiDung(sp, p)
        return { ok: true, loi: null, matPhien: false }
    } catch (e: any) {
        const loi = `Zalo: ${moTa(e)}`
        if (laLoiZalo(e) && !laLoiTamThoi(e) && Date.now() - p.kiemLuc > KIEM_LAI_SAU_MS) {
            const kt = await kiemTraPhien(sp)
            if (kt.song === false) return { ok: false, loi: `${loi} — ${CAU_HET_HAN}`, matPhien: true }
        }
        return { ok: false, loi, matPhien: false }
    }
}

/** Mọi nhóm của tài khoản: getAllGroups (chỉ id) rồi getGroupInfo từng lô 50 (tên, số thành viên).
 *  Trả nguyên phản hồi — lib/zaloGui.ts docNhomTuN8n đọc được dạng gridInfoMap. */
export async function dsNhomZalo(sp: any): Promise<{ raw: any[]; soId: number; loLoi: string[] }> {
    const p = await layApi(sp)
    try {
        const tat: any = await p.api.getAllGroups()
        const ids = Object.keys(tat?.gridVerMap || {})
        const raw: any[] = [], loLoi: string[] = []
        for (let i = 0; i < ids.length; i += 50) {
            try { raw.push(await p.api.getGroupInfo(ids.slice(i, i + 50))) } catch (e: any) { loLoi.push(moTa(e)) }
            if (i + 50 < ids.length) await nghi(300)
        }
        await ghiLaiSauKhiDung(sp, p)
        return { raw, soId: ids.length, loLoi }
    } catch (e: any) {
        if (laLoiZalo(e) && !laLoiTamThoi(e) && Date.now() - p.kiemLuc > KIEM_LAI_SAU_MS) {
            const kt = await kiemTraPhien(sp)
            if (kt.song === false) throw new LoiPhienZalo(CAU_HET_HAN)
        }
        throw e
    }
}

/**
 * GIỮ PHIÊN (nhịp nền, ~25 phút/lần): một lời gọi có xác thực (đọc hồ sơ) — phiên chết thì biết sớm,
 * trước khi chủ shop tạo đợt gửi; Zalo cấp cookie mới thì ghi lại. Bản máy nào giành được "giuLuc"
 * thì bản đó làm, các bản khác bỏ qua. Cửa hàng chưa từng đăng nhập: không tạo bảng, không làm gì.
 */
export async function giuPhien(sp: any): Promise<string> {
    if (!(await coBang(sp))) return ''
    const d = await docDong(sp)
    if (!d || d.trangThai !== 'song') return ''
    const n = await sp.$executeRawUnsafe(
        `UPDATE ${BANG} SET "giuLuc" = now() WHERE "id" = 'default' AND "phienSo" = $1
         AND ("giuLuc" IS NULL OR "giuLuc" < now() - interval '25 minutes')`, d.phienSo)
    if (!Number(n)) return ''
    try {
        const p = await layApi(sp)
        await p.api.fetchAccountInfo()
        await ghiLaiSauKhiDung(sp, p)
        return 'giu'
    } catch (e: any) {
        if (e instanceof LoiPhienZalo) return 'het-han'
        if (laLoiZalo(e) && !laLoiTamThoi(e)) return (await kiemTraPhien(sp)).song === false ? 'het-han' : 'loi'
        return 'loi-mang'
    }
}

// ─── Kích thước ảnh (Zalo cần rộng × cao để hiện ảnh đúng khung) ────────────

/** Đọc rộng × cao từ phần đầu tệp PNG / JPEG / WEBP. Không đọc được thì null (zca-js vẫn gửi, chỉ thiếu khung). */
export function kichThuocAnh(buf: Buffer): { rong: number; cao: number } | null {
    try {
        if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
            return hopLe(buf.readUInt32BE(16), buf.readUInt32BE(20))
        }
        if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
            let i = 2
            while (i + 9 < buf.length) {
                if (buf[i] !== 0xff) { i++; continue }
                const m = buf[i + 1]
                if (m === 0xff) { i++; continue }                                  // byte đệm
                if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }   // dấu đứng một mình
                if (m === 0xd9 || m === 0xda) return null                          // hết ảnh / vào dữ liệu nén mà chưa thấy SOF
                // SOF0..SOF15 trừ DHT (C4), JPG (C8), DAC (CC)
                if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return hopLe(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5))
                i += 2 + buf.readUInt16BE(i + 2)
            }
            return null
        }
        if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
            const loai = buf.toString('ascii', 12, 16)
            if (loai === 'VP8 ') return hopLe(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff)
            if (loai === 'VP8L') { const b = buf.readUInt32LE(21); return hopLe((b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1) }
            if (loai === 'VP8X') return hopLe(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3))
        }
    } catch { /* tệp cụt — coi như không đọc được */ }
    return null
}

function hopLe(rong: number, cao: number): { rong: number; cao: number } | null {
    return rong > 0 && cao > 0 && rong < 100_000 && cao < 100_000 ? { rong, cao } : null
}
