/**
 * CLIENT API KIOTVIET PUBLIC API (2026-08-05)
 *
 * Tài liệu: kiotviet.vn/huong-dan-su-dung-kiotviet/retail-ket-noi-api/public-api
 *
 * Xác thực 2 bước:
 *  1. POST id.kiotviet.vn/connect/token (client_credentials) → access_token 24h
 *  2. Mọi request kèm header `Retailer: <tên gian hàng>` + `Bearer <token>`
 *
 * GIỚI HẠN CỦA SÀN (đọc kỹ trước khi sửa):
 *  - pageSize TỐI ĐA 100, mặc định 20. Xin nhiều hơn thì KiotViet lặng lẽ cắt
 *    về 100 → vòng lặp phân trang phải đi theo `total` chứ không theo số phần
 *    tử nhận được, nếu không sẽ dừng sớm và mất dữ liệu.
 *  - 5000 request/giờ. Quét 100k sản phẩm = 1000 request, vẫn an toàn, nhưng
 *    nhiều store chạy cùng lúc thì phải giãn — có `delayMs` giữa các trang.
 *  - Token hết hạn giữa chừng khi đồng bộ dài: mọi lời gọi đều đi qua
 *    `fetchJson` để tự lấy token mới khi gặp 401, thay vì chết nửa chừng.
 */

export interface KiotVietCreds {
    clientId: string
    clientSecret: string
    retailer: string
}

const TOKEN_URL = 'https://id.kiotviet.vn/connect/token'
const API_BASE = 'https://public.kiotapi.com'
const MAX_PAGE_SIZE = 100

/** Token dùng chung theo clientId — tránh xin token mới cho từng lời gọi */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export class KiotVietError extends Error {
    constructor(message: string, public status?: number, public body?: string) {
        super(message)
        this.name = 'KiotVietError'
    }
}

/** Lấy access token, dùng lại token còn hạn (trừ hao 5 phút). */
export async function getAccessToken(creds: KiotVietCreds, force = false): Promise<string> {
    const key = creds.clientId
    const cached = tokenCache.get(key)
    if (!force && cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.token

    const body = new URLSearchParams({
        scopes: 'PublicApi.Access',
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
    })

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    let resp: Response
    try {
        resp = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: ctrl.signal,
        })
    } catch (e: any) {
        throw new KiotVietError(`Không gọi được máy chủ token KiotViet: ${e?.message || e}`)
    } finally {
        clearTimeout(timer)
    }

    const text = await resp.text()
    if (!resp.ok) {
        // 400 invalid_client = sai client_id/secret — nói thẳng để khỏi mò
        const hint = /invalid_client/i.test(text) ? ' (sai Client ID hoặc Client Secret)' : ''
        throw new KiotVietError(`Lấy token KiotViet thất bại: HTTP ${resp.status}${hint}`, resp.status, text.slice(0, 500))
    }

    let data: any
    try { data = JSON.parse(text) } catch {
        throw new KiotVietError('Máy chủ token KiotViet trả về dữ liệu không phải JSON', resp.status, text.slice(0, 500))
    }
    if (!data?.access_token) {
        throw new KiotVietError('Phản hồi token KiotViet thiếu access_token', resp.status, text.slice(0, 500))
    }

    const ttl = Number(data.expires_in) || 86400
    tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + ttl * 1000 })
    return data.access_token
}

/** Xoá token khỏi bộ nhớ đệm — gọi khi đổi client secret. */
export function clearTokenCache(clientId?: string): void {
    if (clientId) tokenCache.delete(clientId)
    else tokenCache.clear()
}

/**
 * Gọi một endpoint KiotViet. Tự lấy token mới đúng MỘT lần khi gặp 401 (token
 * hết hạn giữa chừng đợt đồng bộ dài), và lùi lại khi bị 429 quá tải.
 */
async function fetchJson(
    creds: KiotVietCreds,
    path: string,
    params: Record<string, any> = {},
    attempt = 0,
): Promise<any> {
    const token = await getAccessToken(creds, attempt > 0 && attempt <= 1)

    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue
        if (Array.isArray(v)) v.forEach(item => qs.append(k, String(item)))
        else qs.append(k, String(v))
    }
    const url = `${API_BASE}${path}${qs.toString() ? `?${qs}` : ''}`

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 60_000)
    let resp: Response
    try {
        resp = await fetch(url, {
            headers: {
                Retailer: creds.retailer,
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
            signal: ctrl.signal,
        })
    } catch (e: any) {
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
            return fetchJson(creds, path, params, attempt + 1)
        }
        throw new KiotVietError(`Lỗi mạng khi gọi KiotViet ${path} (đã thử ${attempt + 1} lần): ${e?.message || e}`)
    } finally {
        clearTimeout(timer)
    }

    // 401 = token hết hạn → xin token mới rồi thử lại đúng một lần
    if (resp.status === 401 && attempt === 0) {
        clearTokenCache(creds.clientId)
        return fetchJson(creds, path, params, 1)
    }
    // 429 = chạm trần 5000 req/h → lùi rồi thử lại
    if (resp.status === 429 && attempt < 3) {
        const wait = Number(resp.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1)
        await new Promise(r => setTimeout(r, wait))
        return fetchJson(creds, path, params, attempt + 1)
    }

    const text = await resp.text()
    if (!resp.ok) {
        throw new KiotVietError(`KiotViet ${path} lỗi HTTP ${resp.status}`, resp.status, text.slice(0, 500))
    }
    try {
        return JSON.parse(text)
    } catch {
        throw new KiotVietError(`KiotViet ${path} trả về dữ liệu không phải JSON`, resp.status, text.slice(0, 300))
    }
}

export interface PageResult<T> {
    total: number
    data: T[]
    removedIds?: number[]
}

/**
 * Duyệt HẾT các trang của một endpoint danh sách.
 *
 * Dừng theo `total` do KiotViet báo, KHÔNG theo "trang rỗng" — một trang rỗng
 * giữa chừng (dữ liệu vừa bị xoá) sẽ cắt cụt đợt quét nếu dừng theo cách đó.
 * Vẫn có chốt chặn vòng lặp vô hạn: quá `maxPages` thì dừng và báo.
 */
export async function fetchAllPages<T = any>(
    creds: KiotVietCreds,
    path: string,
    params: Record<string, any>,
    opts: {
        pageSize?: number
        maxPages?: number
        delayMs?: number
        onPage?: (items: T[], fetched: number, total: number) => Promise<void> | void
    } = {},
): Promise<{ items: T[]; total: number; removedIds: number[]; truncated: boolean }> {
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize || MAX_PAGE_SIZE))
    const maxPages = opts.maxPages ?? 500
    const delayMs = opts.delayMs ?? 120

    const items: T[] = []
    const removedIds: number[] = []
    let currentItem = 0
    let total = 0
    let pages = 0
    let truncated = false

    for (;;) {
        const res: PageResult<T> = await fetchJson(creds, path, { ...params, pageSize, currentItem })
        total = Number(res?.total) || 0
        const batch = Array.isArray(res?.data) ? res.data : []
        // KiotViet đặt tên trường này lúc `removedIds` lúc `removeIds` tuỳ endpoint
        const removed = (res as any)?.removedIds || (res as any)?.removeIds
        if (Array.isArray(removed)) removedIds.push(...removed.map(Number).filter(Number.isFinite))

        if (batch.length) {
            items.push(...batch)
            if (opts.onPage) await opts.onPage(batch, items.length, total)
        }

        currentItem += pageSize
        pages++

        if (currentItem >= total) break
        // Trang rỗng NHƯNG chưa tới total: nhảy tiếp thay vì dừng — nhưng nếu
        // rỗng liên tục tới hết maxPages thì chốt maxPages bên dưới sẽ cắt.
        if (pages >= maxPages) { truncated = true; break }
        if (delayMs) await new Promise(r => setTimeout(r, delayMs))
    }

    return { items, total, removedIds, truncated }
}

/** ISO 8601 mà KiotViet chấp nhận cho lastModifiedFrom/fromPurchaseDate. */
export function kvDate(d: Date | string | undefined | null): string | undefined {
    if (!d) return undefined
    const dt = typeof d === 'string' ? new Date(d) : d
    if (isNaN(dt.getTime())) return undefined
    return dt.toISOString()
}

// ─── Các endpoint dùng trong đồng bộ ────────────────────────────────────────

export const KV = {
    products: (creds: KiotVietCreds, params: Record<string, any>, opts?: any) =>
        fetchAllPages(creds, '/products', { includeInventory: true, ...params }, opts),

    customers: (creds: KiotVietCreds, params: Record<string, any>, opts?: any) =>
        fetchAllPages(creds, '/customers', params, opts),

    /** Chi tiết MỘT khách — dùng để làm tươi số dư ngay khi webhook đụng tới họ */
    customerById: (creds: KiotVietCreds, id: string | number) =>
        fetchJson(creds, `/customers/${id}`, {}),

    suppliers: (creds: KiotVietCreds, params: Record<string, any>, opts?: any) =>
        fetchAllPages(creds, '/suppliers', params, opts),

    invoices: (creds: KiotVietCreds, params: Record<string, any>, opts?: any) =>
        fetchAllPages(creds, '/invoices', { includePayment: true, ...params }, opts),

    orders: (creds: KiotVietCreds, params: Record<string, any>, opts?: any) =>
        fetchAllPages(creds, '/orders', { includePayment: true, ...params }, opts),

    /** Phiếu nhập hàng từ nhà cung cấp */
    purchaseOrders: (creds: KiotVietCreds, params: Record<string, any>, opts?: any) =>
        fetchAllPages(creds, '/purchaseorders', { includeOrderDelivery: false, ...params }, opts),

    /** Sổ quỹ — phiếu thu + phiếu chi nằm chung một endpoint */
    cashflow: (creds: KiotVietCreds, params: Record<string, any>, opts?: any) =>
        fetchAllPages(creds, '/cashflow', params, opts),

    /**
     * Trả hàng BÁN (khách trả lại). Trả hàng MUA (trả nhà cung cấp) không có
     * trong Public API — mọi biến thể đường dẫn đều lỗi, xem ghi chú ở
     * kiotvietSync.syncReturns.
     */
    returns: (creds: KiotVietCreds, params: Record<string, any>, opts?: any) =>
        fetchAllPages(creds, '/returns', params, opts),

    branches: (creds: KiotVietCreds) => fetchJson(creds, '/branches', { pageSize: 100 }),

    /* PHÂN TRANG — KHÔNG được gọi một phát rồi thôi.
     *
     * Bản trước: `fetchJson('/categories', { pageSize: 100 })`. KiotViet kẹp pageSize tối đa
     * 100, nên cửa hàng có nhiều hơn 100 nhóm hàng là **mất phần dư, im lặng**. Đo HUTI
     * 22/08/2026: KiotViet báo total 170, đợt đồng bộ chỉ lấy 100 ⇒ **70 nhóm hàng chưa bao
     * giờ sang**, và người dùng chỉ thấy "vẫn thiếu vài cái".
     *
     * Mọi thực thể khác (products/customers/suppliers/invoices…) đều đã dùng fetchAllPages;
     * riêng categories bị bỏ sót. fetchAllPages dừng theo `total` KiotViet báo, không theo
     * "trang rỗng". */
    categories: async (creds: KiotVietCreds) => {
        const r = await fetchAllPages(creds, '/categories', {})
        return { data: r.items, total: r.total, truncated: r.truncated }
    },

    /** Gọi thẳng một đường dẫn bất kỳ — dùng cho webhook cần nạp lại 1 bản ghi. */
    raw: (creds: KiotVietCreds, path: string, params: Record<string, any> = {}) =>
        fetchJson(creds, path, params),

    /** Danh sách webhook ĐANG đăng ký bên KiotViet */
    listWebhooks: (creds: KiotVietCreds) => fetchJson(creds, '/webhooks', { pageSize: 100 }),

    /**
     * Đăng ký một webhook. Tên sự kiện hợp lệ (đọc được từ chính danh sách đang
     * đăng ký của cửa hàng, 07/08/2026): product.update, stock.update,
     * customer.update, invoice.update, order.update, pricebook.update.
     */
    createWebhook: (creds: KiotVietCreds, type: string, url: string, description: string) =>
        sendJson(creds, 'POST', '/webhooks', {
            Webhook: { Type: type, Url: url, IsActive: true, Description: description },
        }),

    deleteWebhook: (creds: KiotVietCreds, id: string | number) =>
        sendJson(creds, 'DELETE', `/webhooks/${id}`),
}

/** POST/DELETE tới KiotViet. Tách khỏi fetchJson vì fetchJson chỉ làm GET. */
async function sendJson(
    creds: KiotVietCreds, method: 'POST' | 'DELETE', path: string, body?: any, attempt = 0,
): Promise<any> {
    const token = await getAccessToken(creds, attempt === 1)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    let resp: Response
    try {
        resp = await fetch(`${API_BASE}${path}`, {
            method,
            headers: {
                Retailer: creds.retailer,
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: ctrl.signal,
        })
    } catch (e: any) {
        throw new KiotVietError(`Lỗi mạng khi ${method} ${path}: ${e?.message || e}`)
    } finally {
        clearTimeout(timer)
    }

    if (resp.status === 401 && attempt === 0) {
        clearTokenCache(creds.clientId)
        return sendJson(creds, method, path, body, 1)
    }
    const text = await resp.text()
    if (!resp.ok) {
        throw new KiotVietError(`KiotViet ${method} ${path} lỗi HTTP ${resp.status}: ${text.slice(0, 300)}`, resp.status, text.slice(0, 500))
    }
    try { return text ? JSON.parse(text) : { ok: true } } catch { return { ok: true, raw: text.slice(0, 200) } }
}

/**
 * Thử kết nối: lấy token + gọi /branches. Trả thông tin gian hàng để người dùng
 * đối chiếu đúng shop trước khi bấm đồng bộ thật.
 */
export async function testConnection(creds: KiotVietCreds): Promise<{
    ok: boolean
    retailer: string
    branches: { id: number; name: string }[]
    error?: string
}> {
    try {
        const res = await KV.branches(creds)
        const branches = (res?.data || []).map((b: any) => ({ id: Number(b.id), name: String(b.branchName || b.name || '') }))
        return { ok: true, retailer: creds.retailer, branches }
    } catch (e: any) {
        return { ok: false, retailer: creds.retailer, branches: [], error: e?.message || String(e) }
    }
}
