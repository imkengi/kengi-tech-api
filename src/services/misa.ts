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

/** Loại danh mục của get_dictionary — số lấy từ tài liệu MISA. */
export const MISA_DATA_TYPE = {
    DOI_TUONG: 1,        // khách hàng / nhà cung cấp / nhân viên (chung một bảng)
    VAT_TU: 2,           // vật tư, hàng hoá
    KHO: 3,
    DON_VI_TINH: 4,
    HE_THONG_TAI_KHOAN: 5,
    CO_CAU_TO_CHUC: 6,
    TAI_KHOAN_NGAN_HANG: 8,
    DIEU_KHOAN_THANH_TOAN: 11,
    NGAN_HANG: 12,
    NHOM_VAT_TU: 14,
} as const

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
): Promise<{ items: any[]; truncated: boolean }> {
    const take = Math.min(MAX_TAKE, Math.max(1, opts.take || MAX_TAKE))
    const maxPages = opts.maxPages ?? 500
    const delayMs = opts.delayMs ?? 120

    const items: any[] = []
    let skip = 0
    let pages = 0
    let truncated = false

    for (;;) {
        const raw = await misaPost(creds, path, { ...body, skip, take })
        const batch = toArray(unwrap(raw))
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
    return { items, truncated }
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

    /** Gọi thẳng một hàm bất kỳ — dùng để soi dữ liệu thô khi chẩn đoán */
    raw: (creds: MisaCreds, path: string, body: Record<string, any> = {}) =>
        misaPost(creds, path, body),
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
