/**
 * CLIENT MISA AMIS KẾ TOÁN — ACT OPEN API (2026-08-09)
 *
 * Tài liệu: actdocs.misa.vn/g2/graph/ACTOpenAPIHelp
 *
 * Xác thực:
 *   POST /api/oauth/actopen/connect  {app_id, access_code, org_company_code}
 *   → {access_token, expired_time}  — token sống 12 giờ
 *   Mọi lời gọi sau kèm header `X-MISA-AccessToken`.
 *
 * KHÁC BIỆT LỚN SO VỚI KIOTVIET — đọc kỹ trước khi hứa tính năng:
 *   MISA CHỈ CHO KÉO DANH MỤC (get_dictionary) và TỒN KHO
 *   (get_list_inventory_balance). CHỨNG TỪ (hoá đơn bán, phiếu thu/chi, nhập
 *   kho) KHÔNG có hàm lấy về — API chỉ có `save` để ĐẨY LÊN, và `request_data`
 *   để MISA gửi ngược qua callback của đối tác. MISA là nơi NHẬN số liệu kế
 *   toán, không phải nguồn để rút chứng từ ra.
 *
 * Các hàm KÉO VỀ hiện dùng (mục 2.4, 2.6, 2.7, 2.9, 2.12 của tài liệu):
 *   get_dictionary             danh mục theo data_type
 *   get_list_acc_obj_debt      công nợ phải thu / phải trả
 *   get_list_inventory_balance tồn kho theo từng kho
 *   get_dictionary_delete      danh mục đã bị xoá bên MISA
 *   get_company_info           thông tin công ty
 *
 * Hàm ĐẨY LÊN (mục 2.2, 2.3, 2.14, 2.16) — CHƯA DÙNG, ghi lại để khỏi đọc lại
 * tài liệu: `save` (đề nghị sinh chứng từ), `save_dictionary` (sinh danh mục),
 * `delete` (xoá đề nghị), `get_call_back_detail_error` (tra kết quả). Lưu ý
 * `save` là BẤT ĐỒNG BỘ — HTTP 200 chỉ nghĩa là MISA NHẬN ĐƯỢC, chưa phải đã
 * ghi sổ.
 *
 * Đường dẫn có hai tiền tố khác nhau, dễ nhầm:
 *   `/api/oauth/...`  cho xác thực
 *   `/apir/sync/...`  cho dữ liệu   (apiR — có chữ R)
 */

export interface MisaCreds {
    appId: string
    accessCode: string
    orgCompanyCode: string
    /** Mặc định actapp.misa.vn; cho phép đổi khi MISA cấp máy chủ riêng */
    baseUrl?: string
}

const DEFAULT_BASE = 'https://actapp.misa.vn'
const MAX_TAKE = 100

/**
 * Loại danh mục của get_dictionary — chép từ mục 3.3 "Danh sách các loại danh
 * mục hỗ trợ LẤY từ AMIS kế toán" (EnumOpenGetDictionaryType).
 *
 * ĐỪNG lẫn với `dictionary_type` ở mục 3.2 (danh mục ĐẨY LÊN) — hai bảng số
 * KHÁC NHAU: chiều lấy về Kho = 3, chiều đẩy lên Kho = 5. Trước đây file này có
 * NHOM_VAT_TU: 14 — số đó không nằm trong danh sách nào, đã bỏ.
 *
 * CẢNH BÁO: ví dụ trong chính tài liệu (mục 2.4) gửi data_type = 5 mà nhận về
 * bản ghi KHO, tức mâu thuẫn với mục 3.3. Không đoán bên nào đúng — dùng
 * GET /api/misa/probe để hỏi thẳng dữ liệu thật của cửa hàng rồi mới chốt.
 */
export const MISA_DATA_TYPE = {
    DOI_TUONG: 1,        // khách hàng / nhà cung cấp / nhân viên (chung một bảng)
    VAT_TU: 2,           // vật tư, hàng hoá
    KHO: 3,
    DON_VI_TINH: 4,
    HE_THONG_TAI_KHOAN: 5,
    CO_CAU_TO_CHUC: 6,
    TAI_KHOAN_NGAN_HANG: 8,
    CONG_TRINH: 9,
    DOI_TUONG_THCP: 10,
    DIEU_KHOAN_THANH_TOAN: 11,
    NGAN_HANG: 12,
} as const

/** Nhãn tiếng Việt cho từng data_type — dùng ở màn dò danh mục. */
export const MISA_DATA_TYPE_LABEL: Record<number, string> = {
    1: 'Đối tượng (KH/NCC/NV)',
    2: 'Vật tư, hàng hoá',
    3: 'Kho',
    4: 'Đơn vị tính',
    5: 'Hệ thống tài khoản',
    6: 'Cơ cấu tổ chức',
    8: 'Tài khoản ngân hàng',
    9: 'Công trình',
    10: 'Đối tượng tập hợp chi phí',
    11: 'Điều khoản thanh toán',
    12: 'Ngân hàng',
}

/** Loại công nợ của get_list_acc_obj_debt — 0 phải thu, 1 phải trả. */
export const MISA_DEBT_TYPE = { PHAI_THU: 0, PHAI_TRA: 1 } as const

export class MisaError extends Error {
    constructor(message: string, public status?: number, public body?: string) {
        super(message)
        this.name = 'MisaError'
    }
}

/** Token dùng chung theo appId+công ty — token sống 12h, đừng xin lại mỗi lượt. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

const cacheKeyOf = (c: MisaCreds) => `${c.appId}|${c.orgCompanyCode}`

export function clearMisaToken(creds?: MisaCreds): void {
    if (creds) tokenCache.delete(cacheKeyOf(creds))
    else tokenCache.clear()
}

export async function getMisaToken(creds: MisaCreds, force = false): Promise<string> {
    const key = cacheKeyOf(creds)
    const cached = tokenCache.get(key)
    // Trừ hao 10 phút — token hết hạn giữa một đợt quét dài là hỏng cả đợt
    if (!force && cached && cached.expiresAt > Date.now() + 10 * 60_000) return cached.token

    const base = (creds.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    let resp: Response
    try {
        resp = await fetch(`${base}/api/oauth/actopen/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: creds.appId,
                access_code: creds.accessCode,
                org_company_code: creds.orgCompanyCode,
            }),
            signal: ctrl.signal,
        })
    } catch (e: any) {
        throw new MisaError(`Không gọi được máy chủ MISA: ${e?.message || e}`)
    } finally {
        clearTimeout(timer)
    }

    const text = await resp.text()
    if (!resp.ok) {
        throw new MisaError(`Lấy token MISA thất bại: HTTP ${resp.status}`, resp.status, text.slice(0, 500))
    }
    let data: any
    try { data = JSON.parse(text) } catch {
        throw new MisaError('MISA trả về dữ liệu không phải JSON khi lấy token', resp.status, text.slice(0, 500))
    }

    /**
     * MISA bọc kết quả trong {Success, Data, ErrorMessage} và có bản trả thẳng.
     * `Data` đôi khi là CHUỖI JSON chứ không phải object — nhận cả hai kiểu, nếu
     * không thì access_token luôn undefined mà không hiểu vì sao.
     */
    const payload = unwrap(data)
    const token = payload?.access_token || payload?.AccessToken || payload?.accessToken
    if (!token) {
        const loi = data?.ErrorMessage || data?.errorMessage || ''
        throw new MisaError(
            `Phản hồi token MISA thiếu access_token${loi ? ` — ${loi}` : ''}`,
            resp.status, text.slice(0, 500),
        )
    }
    // expired_time là mốc hết hạn; không đọc được thì lấy 12h theo tài liệu
    const hetHan = Date.parse(payload?.expired_time || '') || (Date.now() + 12 * 3600_000)
    tokenCache.set(key, { token, expiresAt: hetHan })
    return token
}

/** Gỡ lớp bọc {Success, Data} của MISA; `Data` có thể là chuỗi JSON. */
export function unwrap(raw: any): any {
    if (raw == null) return raw
    const d = raw?.Data ?? raw?.data ?? raw
    if (typeof d === 'string') {
        try { return JSON.parse(d) } catch { return d }
    }
    return d
}

/** POST tới MISA kèm token; tự xin token mới đúng một lần khi bị từ chối. */
async function misaPost(creds: MisaCreds, path: string, body: Record<string, any>, attempt = 0): Promise<any> {
    const token = await getMisaToken(creds, attempt > 0)
    const base = (creds.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 60_000)
    let resp: Response
    try {
        resp = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-MISA-AccessToken': token,
            },
            body: JSON.stringify({ app_id: creds.appId, org_company_code: creds.orgCompanyCode, ...body }),
            signal: ctrl.signal,
        })
    } catch (e: any) {
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
            return misaPost(creds, path, body, attempt + 1)
        }
        throw new MisaError(`Lỗi mạng khi gọi MISA ${path} (đã thử ${attempt + 1} lần): ${e?.message || e}`)
    } finally {
        clearTimeout(timer)
    }

    if ((resp.status === 401 || resp.status === 403) && attempt === 0) {
        clearMisaToken(creds)
        return misaPost(creds, path, body, 1)
    }

    const text = await resp.text()
    if (!resp.ok) {
        throw new MisaError(`MISA ${path} lỗi HTTP ${resp.status}`, resp.status, text.slice(0, 400))
    }
    let data: any
    try { data = JSON.parse(text) } catch {
        throw new MisaError(`MISA ${path} trả về dữ liệu không phải JSON`, resp.status, text.slice(0, 300))
    }
    // Lỗi nghiệp vụ MISA trả HTTP 200 kèm Success=false — không bắt là nuốt lỗi
    if (data?.Success === false || data?.success === false) {
        const msg = data?.ErrorMessage || data?.errorMessage || 'không rõ nguyên nhân'
        throw new MisaError(`MISA ${path} báo lỗi: ${msg}`, resp.status, text.slice(0, 400))
    }
    return data
}

/**
 * Duyệt HẾT các trang của một hàm dạng danh sách.
 *
 * MISA phân trang bằng skip/take (take tối đa 100) và KHÔNG trả tổng số bản
 * ghi, nên phải dừng khi trang trả về ít hơn `take` — khác KiotViet (dừng theo
 * `total`). Vẫn có chốt maxPages phòng vòng lặp vô tận.
 */
export async function misaFetchAll(
    creds: MisaCreds,
    path: string,
    body: Record<string, any>,
    opts: {
        take?: number
        maxPages?: number
        delayMs?: number
        onPage?: (items: any[], fetched: number) => Promise<void> | void
    } = {},
): Promise<{ items: any[]; truncated: boolean; lastSyncTime: string | null; message: string | null }> {
    const take = Math.min(MAX_TAKE, Math.max(1, opts.take || MAX_TAKE))
    const maxPages = opts.maxPages ?? 500
    const delayMs = opts.delayMs ?? 120

    const items: any[] = []
    let skip = 0
    let pages = 0
    let truncated = false
    let lastSyncTime: string | null = null
    let message: string | null = null

    for (;;) {
        const raw = await misaPost(creds, path, { ...body, skip, take })
        const batch = toArray(unwrap(raw))
        // MISA tự trả về MỐC NƯỚC cho lần sau trong CustomData.LastSyncTime —
        // dùng nó chính xác hơn là tự đoán "từ ngày" theo đồng hồ máy mình
        const custom = docCustomData(raw)
        if (custom?.LastSyncTime) lastSyncTime = String(custom.LastSyncTime)
        if (custom?.Message) message = String(custom.Message).slice(0, 300)
        if (batch.length) {
            items.push(...batch)
            if (opts.onPage) await opts.onPage(batch, items.length)
        }
        pages++
        // Trang thiếu so với `take` = đã hết dữ liệu
        if (batch.length < take) break
        if (pages >= maxPages) { truncated = true; break }
        skip += take
        if (delayMs) await new Promise(r => setTimeout(r, delayMs))
    }
    return { items, truncated, lastSyncTime, message }
}

/** CustomData cũng có thể là CHUỖI JSON như Data — cùng một bệnh. */
function docCustomData(raw: any): any {
    const cd = raw?.CustomData ?? raw?.customData
    if (!cd) return null
    if (typeof cd === 'string') {
        try { return JSON.parse(cd) } catch { return null }
    }
    return typeof cd === 'object' ? cd : null
}

/** MISA có chỗ trả mảng thẳng, có chỗ bọc trong {Data:{PageData:[...]}}. */
function toArray(v: any): any[] {
    if (Array.isArray(v)) return v
    if (!v || typeof v !== 'object') return []
    for (const k of ['PageData', 'pageData', 'Data', 'data', 'Items', 'items']) {
        const inner = (v as any)[k]
        if (Array.isArray(inner)) return inner
        if (typeof inner === 'string') {
            try { const p = JSON.parse(inner); if (Array.isArray(p)) return p } catch { /* bỏ qua */ }
        }
    }
    return []
}

/** Định dạng thời gian MISA đòi: "YYYY-MM-DD HH:mm:ss" (giờ Việt Nam). */
export function misaTime(d: Date | string | null | undefined): string | null {
    if (!d) return null
    const dt = typeof d === 'string' ? new Date(d) : d
    if (isNaN(dt.getTime())) return null
    const vn = new Date(dt.getTime() + 7 * 3600_000)
    return vn.toISOString().slice(0, 19).replace('T', ' ')
}

export const MISA = {
    /** Danh mục theo data_type (xem MISA_DATA_TYPE) */
    danhMuc: (creds: MisaCreds, dataType: number, params: Record<string, any> = {}, opts?: any) =>
        misaFetchAll(creds, '/apir/sync/actopen/get_dictionary',
            { data_type: dataType, branch_id: null, last_sync_time: null, ...params }, opts),

    /** Tồn kho theo từng kho */
    tonKho: (creds: MisaCreds, params: Record<string, any> = {}, opts?: any) =>
        misaFetchAll(creds, '/apir/sync/actopen/get_list_inventory_balance',
            { stock_id: null, branch_id: null, last_sync_time: null, ...params }, opts),

    /**
     * Công nợ phải thu (loai = 0) / phải trả (loai = 1).
     *
     * DẤU của `debt_amount` KHÔNG được suy diễn: ví dụ trong tài liệu cho công
     * nợ phải trả là SỐ ÂM (-235.800.000). Trước khi ghi vào Kengi phải soi dữ
     * liệu thật của cửa hàng bằng /peek — xem ghi chú ở syncMisaDebt.
     */
    congNo: (creds: MisaCreds, loai: number, params: Record<string, any> = {}, opts?: any) =>
        misaFetchAll(creds, '/apir/sync/actopen/get_list_acc_obj_debt',
            { data_type: loai, branch_id: null, last_sync_time: null, ...params }, opts),

    /** Danh mục ĐÃ BỊ XOÁ bên MISA — để ngừng theo dõi bên Kengi, KHÔNG xoá thật */
    danhMucDaXoa: (creds: MisaCreds, dataType: number, params: Record<string, any> = {}, opts?: any) =>
        misaFetchAll(creds, '/apir/sync/actopen/get_dictionary_delete',
            { data_type: dataType, branch_id: null, last_sync_time: null, ...params }, opts),

    /** Thông tin công ty — không phân trang, trả về một object */
    thongTinCongTy: async (creds: MisaCreds): Promise<any> =>
        unwrap(await misaPost(creds, '/apir/sync/actopen/get_company_info', { branch_id: null })),

    /** Gọi thẳng một hàm bất kỳ — dùng để soi dữ liệu thô khi chẩn đoán */
    raw: (creds: MisaCreds, path: string, body: Record<string, any> = {}) =>
        misaPost(creds, path, body),
}

/**
 * DÒ xem mỗi `data_type` thật sự trả về cái gì trên dữ liệu của cửa hàng này.
 *
 * Sinh ra vì tài liệu MISA tự mâu thuẫn (mục 2.4 gửi data_type = 5 lại nhận về
 * bản ghi kho, trong khi mục 3.3 nói 5 = hệ thống tài khoản). Lấy 1 bản ghi mỗi
 * loại rồi đọc TÊN TRƯỜNG để biết đó là danh mục gì — đo thay vì đoán.
 */
export async function doDanhMuc(creds: MisaCreds, loai: number[] = Object.values(MISA_DATA_TYPE)): Promise<Array<{
    dataType: number
    nhanTheoTaiLieu: string
    soBanGhi: number
    doanLa: string
    cacTruong: string[]
    banGhiMau: any
    loi?: string
}>> {
    const ketQua: any[] = []
    for (const dt of loai) {
        try {
            const { items } = await misaFetchAll(creds, '/apir/sync/actopen/get_dictionary',
                { data_type: dt, branch_id: null, last_sync_time: null }, { take: 1, maxPages: 1, delayMs: 0 })
            const mau = items[0] || null
            ketQua.push({
                dataType: dt,
                nhanTheoTaiLieu: MISA_DATA_TYPE_LABEL[dt] || '(không có trong tài liệu)',
                soBanGhi: items.length,
                doanLa: doanTenDanhMuc(mau),
                cacTruong: mau ? Object.keys(mau) : [],
                banGhiMau: mau,
            })
        } catch (e: any) {
            ketQua.push({
                dataType: dt, nhanTheoTaiLieu: MISA_DATA_TYPE_LABEL[dt] || '(không có trong tài liệu)',
                soBanGhi: 0, doanLa: '', cacTruong: [], banGhiMau: null,
                loi: String(e?.message || e).slice(0, 200),
            })
        }
    }
    return ketQua
}

/** Nhìn khoá chính trong bản ghi để biết MISA vừa trả về danh mục nào. */
function doanTenDanhMuc(m: any): string {
    if (!m || typeof m !== 'object') return ''
    const dau: Array<[string, string]> = [
        ['inventory_item_id', 'Vật tư, hàng hoá'],
        ['account_object_id', 'Đối tượng (KH/NCC/NV)'],
        ['stock_id', 'Kho'],
        ['unit_id', 'Đơn vị tính'],
        ['bank_account_id', 'Tài khoản ngân hàng'],
        ['payment_term_id', 'Điều khoản thanh toán'],
        ['project_work_id', 'Công trình'],
        ['job_id', 'Đối tượng tập hợp chi phí'],
        ['organization_unit_id', 'Cơ cấu tổ chức'],
        ['account_number', 'Hệ thống tài khoản'],
        ['bank_id', 'Ngân hàng'],
    ]
    for (const [k, ten] of dau) if (k in m) return ten
    return '(không nhận ra)'
}

/**
 * Thử kết nối: lấy token rồi gọi thử danh mục KHO (nhỏ, gần như shop nào cũng
 * có) để chắc là token dùng được, không chỉ xin được.
 */
export async function testMisaConnection(creds: MisaCreds): Promise<{
    ok: boolean
    khoCount?: number
    khoMau?: string[]
    error?: string
}> {
    try {
        await getMisaToken(creds, true)
        const { items } = await MISA.danhMuc(creds, MISA_DATA_TYPE.KHO, {}, { take: 20, maxPages: 1 })
        return {
            ok: true,
            khoCount: items.length,
            khoMau: items.slice(0, 5).map((k: any) => String(k?.stock_name || k?.stock_code || '')).filter(Boolean),
        }
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
    }
}
