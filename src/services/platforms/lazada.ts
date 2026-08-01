import { PlatformService, PlatformCredentials, PlatformOrder, PlatformOrderItem, PlatformProduct, TokenResponse } from './base'

// ═══════════════════════════════════════════════════════════════════════════════
//  LAZADA OPEN PLATFORM
//  Docs: https://open.lazada.com/apps/doc/api?path=/order/get
// ═══════════════════════════════════════════════════════════════════════════════

const LAZADA_AUTH = 'https://auth.lazada.com'
const LAZADA_API = 'https://api.lazada.vn/rest'  // Vietnam region

export class LazadaService extends PlatformService {
    get platformName() { return 'lazada' }

    // ─── Egress qua proxy Tino (IP tĩnh đã whitelist) ────────────────────────────
    // App Lazada bắt buộc khai IP whitelist (open.lazada.com → App → IP Whitelist);
    // Cloud Run đi ra bằng IP ĐỘNG nên Lazada chặn với "The binding IP whitelist of
    // the app does not contain the source IP of the current request". Dùng chung
    // proxy chuyển tiếp câm với Shopee (IP tĩnh 103.130.216.108 đã khai trong
    // whitelist) — backend VẪN tự ký, proxy chỉ forward URL y nguyên.
    // Chưa cấu hình env → gọi thẳng như cũ (fallback an toàn).
    // Cùng chuyện với Shopee: proxy Tino là hosting dùng chung, không đặt hạn giờ
    // thì request treo tới khi undici bỏ cuộc và ném "fetch failed" trần trụi.
    private static readonly FETCH_TIMEOUT_MS = 30_000
    private static readonly FETCH_RETRIES = 3

    private async lazadaFetch(url: string, method: 'GET' | 'POST', body?: any): Promise<Response> {
        const proxy = process.env.PLATFORM_FORWARD_PROXY || process.env.SHOPEE_FORWARD_PROXY
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

        const attempt = async (): Promise<Response> => {
            const ac = new AbortController()
            const timer = setTimeout(() => ac.abort(), LazadaService.FETCH_TIMEOUT_MS)
            try {
                if (!proxy) {
                    return await fetch(url, {
                        method,
                        headers: { 'Content-Type': 'application/json' },
                        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
                        signal: ac.signal,
                    })
                }
                return await fetch(proxy, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        secret: process.env.PLATFORM_FORWARD_SECRET || process.env.SHOPEE_FORWARD_SECRET || '',
                        url,
                        method,
                        body: method === 'POST' ? (body ?? {}) : undefined,
                    }),
                    signal: ac.signal,
                })
            } finally {
                clearTimeout(timer)
            }
        }

        let lastErr: any
        for (let i = 0; i < LazadaService.FETCH_RETRIES; i++) {
            try {
                return await attempt()
            } catch (e: any) {
                lastErr = e
                if (i < LazadaService.FETCH_RETRIES - 1) {
                    console.warn(`[Lazada fetch] lần ${i + 1} lỗi (${e?.message}) — thử lại`)
                    await sleep(1000 * 2 ** i)
                }
            }
        }
        const where = proxy ? `proxy ${proxy}` : 'Lazada trực tiếp'
        throw new Error(
            `Gọi ${where} thất bại sau ${LazadaService.FETCH_RETRIES} lần` +
            `${lastErr?.name === 'AbortError' ? ` (quá ${LazadaService.FETCH_TIMEOUT_MS / 1000}s)` : ''}: ${lastErr?.message || lastErr}`
        )
    }

    protected async httpGet(url: string): Promise<any> {
        return this.parseResponse(await this.lazadaFetch(url, 'GET'))
    }

    protected async httpPost(url: string, body: any): Promise<any> {
        return this.parseResponse(await this.lazadaFetch(url, 'POST', body))
    }

    // ─── Auth ────────────────────────────────────────────────────────────────────

    private signRequest(apiPath: string, params: Record<string, string>): string {
        const sorted = Object.keys(params).sort()
        const concat = apiPath + sorted.map(k => `${k}${params[k]}`).join('')
        return this.hmacSha256(concat, this.credentials.apiSecret).toUpperCase()
    }

    private buildUrl(apiPath: string, extraParams: Record<string, string> = {}): string {
        const timestamp = Date.now()
        const params: Record<string, string> = {
            app_key: this.credentials.apiKey,
            timestamp: String(timestamp),
            sign_method: 'sha256',
            access_token: this.credentials.accessToken || '',
            ...extraParams,
        }
        const sign = this.signRequest(apiPath, params)
        params.sign = sign
        const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
        return `${LAZADA_API}${apiPath}?${qs}`
    }

    generateAuthUrl(redirectUri: string, state: string): string {
        // App Key rỗng vẫn sinh ra URL hợp lệ về mặt cú pháp (client_id=) nhưng Lazada
        // sẽ trả trang lỗi "Thiếu Tham số" — chặn sớm để báo đúng nguyên nhân.
        const appKey = (this.credentials.apiKey || '').trim()
        if (!appKey) {
            throw new Error('Chưa có App Key cho kênh Lazada. Vui lòng nhập App Key / App Secret (lấy trên open.lazada.com) trước khi kết nối.')
        }
        const params = new URLSearchParams({
            response_type: 'code',
            // Lazada yêu cầu force_auth=true trên endpoint authorize, thiếu thì trang
            // uỷ quyền báo "Thiếu Tham số".
            force_auth: 'true',
            redirect_uri: redirectUri,
            client_id: appKey,
            state,
        })
        return `${LAZADA_AUTH}/oauth/authorize?${params}`
    }

    async exchangeToken(code: string, redirectUri: string): Promise<TokenResponse> {
        const apiPath = '/auth/token/create'
        const params: Record<string, string> = {
            app_key: this.credentials.apiKey,
            timestamp: String(Date.now()),
            sign_method: 'sha256',
            code,
        }
        const sign = this.signRequest(apiPath, params)
        params.sign = sign
        const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
        const url = `${LAZADA_API}${apiPath}?${qs}`

        const data = await this.httpGet(url)
        if (data.code !== '0' && data.code !== 0) throw new Error(`Lazada auth error: ${data.message || data.code}`)

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in || 604800,
            shopId: data.country_user_info?.[0]?.seller_id || undefined,
        }
    }

    async refreshAccessToken(): Promise<TokenResponse> {
        const apiPath = '/auth/token/refresh'
        const params: Record<string, string> = {
            app_key: this.credentials.apiKey,
            timestamp: String(Date.now()),
            sign_method: 'sha256',
            refresh_token: this.credentials.refreshToken || '',
        }
        const sign = this.signRequest(apiPath, params)
        params.sign = sign
        const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
        const url = `${LAZADA_API}${apiPath}?${qs}`

        const data = await this.httpGet(url)
        if (data.code !== '0' && data.code !== 0) throw new Error(`Lazada refresh error: ${data.message}`)

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in || 604800,
        }
    }

    // ─── Orders ──────────────────────────────────────────────────────────────────

    async fetchOrders(params: { since?: Date; until?: Date; page?: number; pageSize?: number }) {
        const offset = ((params.page || 1) - 1) * (params.pageSize || 50)
        const extraParams: Record<string, string> = {
            sort_direction: 'DESC',
            sort_by: 'updated_at',
            offset: String(offset),
            limit: String(Math.min(params.pageSize || 50, 100)),
        }
        if (params.since) {
            extraParams.update_after = params.since.toISOString()
        }
        if (params.until) {
            extraParams.update_before = params.until.toISOString()
        }

        const url = this.buildUrl('/orders/get', extraParams)
        const data = await this.httpGet(url)

        if (data.code !== '0' && data.code !== 0) throw new Error(`Lazada getOrders: ${data.message}`)

        const orderList = data.data?.orders || []
        const orders: PlatformOrder[] = []

        for (const o of orderList) {
            // Fetch items for each order
            const itemsUrl = this.buildUrl('/order/items/get', { order_id: String(o.order_id) })
            const itemsData = await this.httpGet(itemsUrl)
            const items = itemsData.data || []

            orders.push(this.mapOrder(o, items))
        }

        return {
            orders,
            hasMore: orderList.length >= (params.pageSize || 50),
            total: data.data?.count || orders.length,
        }
    }

    /** Lỗi thuộc về KÊNH (token/IP whitelist) chứ không phải về một đơn cụ thể. */
    static isChannelAuthError(code: any, msg?: string): boolean {
        const s = `${code ?? ''} ${msg ?? ''}`
        return /IllegalAccessToken|InvalidToken|AccessTokenExpire|IP whitelist|MissingParameter:access_token/i.test(s)
    }

    // TRƯỚC ĐÂY: `if (code !== 0) return null` — nuốt sạch lỗi, chỗ gọi lại bỏ qua
    // im lặng nên hỏng cả kênh vẫn báo "không có gì mới". Cùng kiểu lỗi đã sửa ở
    // Shopee getTrackingNumber và TikTok getOrderDetail.
    async getOrderDetail(externalOrderId: string): Promise<PlatformOrder | null> {
        const url = this.buildUrl('/order/get', { order_id: externalOrderId })
        const data = await this.httpGet(url)

        if (data.code !== '0' && data.code !== 0) {
            const detail = `[${data.code}] ${data.message || data.error_message || 'không rõ'}`
            if (LazadaService.isChannelAuthError(data.code, data.message)) {
                throw new Error(`Lazada từ chối kênh: ${detail}`)
            }
            console.warn(`[Lazada] getOrderDetail ${externalOrderId}: ${detail}`)
            return null
        }

        const itemsUrl = this.buildUrl('/order/items/get', { order_id: externalOrderId })
        const itemsData = await this.httpGet(itemsUrl)

        return this.mapOrder(data.data, itemsData.data || [])
    }

    /**
     * NGÀY KHÁCH NHẬN HÀNG THẬT của đơn Lazada — đọc từ VẬN ĐƠN.
     * GET /logistic/order/trace (GetOrderTrace).
     *
     * Doc ghi rõ: "only available in the state after ready to ship" → đơn chưa
     * đóng gói mà gọi là lỗi, chỗ gọi phải lọc trạng thái trước.
     *
     * Doc KHÔNG liệt kê bảng mã trạng thái (ví dụ duy nhất là status_code 1200 /
     * detail_type "ready_to"). Nên nhận diện phải PHÒNG THỦ và phải LOẠI TRỪ mấy
     * chuỗi dễ nhầm: "out for delivery" (đang đi giao) và "delivery failed" đều
     * chứa chữ deliver — bắt nhầm là chốt "đã giao" cho đơn chưa tới tay khách,
     * kéo theo hàng đợi xuất hoá đơn sai.
     *
     * `dumpVocab` = in ra từ vựng sự kiện thô để đối chiếu với dữ liệu thật rồi
     * siết lại luật, thay vì đoán.
     */
    async getDeliveredTime(orderId: string, opts: { dumpVocab?: boolean } = {}): Promise<Date | null> {
        const url = this.buildUrl('/logistic/order/trace', { order_id: orderId })
        const data = await this.httpGet(url)

        if (data.code !== '0' && data.code !== 0) {
            const detail = `[${data.code}] ${data.message || data.error_message || 'không rõ'}`
            if (LazadaService.isChannelAuthError(data.code, data.message)) {
                throw new Error(`Lazada từ chối kênh: ${detail}`)
            }
            throw new Error(`Lazada trace ${orderId}: ${detail}`)
        }

        const modules: any[] = data.result?.module || data.data?.module || []
        const events: any[] = []
        for (const m of modules) {
            for (const p of (m?.package_detail_info_list || [])) {
                for (const e of (p?.logistic_detail_info_list || [])) events.push(e)
            }
        }
        if (events.length === 0) return null

        if (opts.dumpVocab) {
            const vocab = events.map(e =>
                `${e.status_code ?? '?'}|${e.detail_type ?? '?'}|${String(e.title ?? '').slice(0, 40)}`)
            console.log(`[Lazada trace] ${orderId} từ vựng sự kiện: ${JSON.stringify([...new Set(vocab)])}`)
        }

        // Phải có dấu hiệu THÀNH CÔNG rõ ràng...
        const SUCCESS = /\bdelivered\b|delivery[_\s-]?success|giao (hàng )?thành công|đã giao( hàng)? thành công/i
        // ...và KHÔNG dính mấy chuỗi gây nhầm.
        const NOT_YET = /fail|unsuccessful|attempt|out for delivery|đang giao|giao không thành công|returned|hoàn/i

        const ms = events
            .filter(e => {
                const blob = `${e.status_code ?? ''} ${e.detail_type ?? ''} ${e.title ?? ''} ${e.description ?? ''}`
                return SUCCESS.test(blob) && !NOT_YET.test(blob)
            })
            .map(e => Number(e.event_time ?? e.receive_time ?? 0))
            .filter(n => n > 0)
            // event_time là mili giây (ví dụ trong doc: 1625987646597)
            .map(n => (n < 1e12 ? n * 1000 : n))

        if (ms.length === 0) return null
        return new Date(Math.min(...ms))   // lần giao thành công đầu tiên
    }

    async testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }> {
        try {
            const url = this.buildUrl('/seller/get')
            const data = await this.httpGet(url)

            if (data.code !== '0' && data.code !== 0) return { success: false, error: data.message || 'Unknown error' }
            return { success: true, shopName: data.data?.name || data.data?.company || 'Lazada Shop' }
        } catch (err: any) {
            return { success: false, error: err.message }
        }
    }

    async fetchProducts(): Promise<{ products: PlatformProduct[]; total: number }> {
        // TODO: Implement Lazada product sync
        console.log('[Lazada] fetchProducts not yet implemented')
        return { products: [], total: 0 }
    }

    // ─── Mappers ─────────────────────────────────────────────────────────────────

    private mapOrder(o: any, rawItems: any[]): PlatformOrder {
        const items: PlatformOrderItem[] = rawItems.map((item: any) => ({
            externalItemId: String(item.order_item_id || item.item_id),
            productName: item.name,
            sku: item.sku,
            quantity: 1, // Lazada: each item row = 1 qty
            unitPrice: parseFloat(item.item_price || '0'),
            discount: parseFloat(item.voucher_seller || '0'),
            lineTotal: parseFloat(item.paid_price || item.item_price || '0'),
        }))

        const addr = o.address_shipping || {}

        return {
            externalOrderId: String(o.order_id),
            orderNumber: `LZD-${o.order_number || o.order_id}`,
            platform: 'lazada',
            status: this.mapStatus(o.statuses?.[0] || o.status || ''),
            externalStatus: o.statuses?.[0] || o.status || '',
            customerName: `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || o.customer_first_name || 'Khách Lazada',
            customerPhone: addr.phone || o.customer_phone || '',
            shippingAddress: [addr.address1, addr.address2, addr.address3, addr.city, addr.country].filter(Boolean).join(', '),
            subtotal: parseFloat(o.price || '0'),
            discount: 0,
            shippingFee: parseFloat(o.shipping_fee || '0'),
            total: parseFloat(o.price || '0'),
            paymentMethod: o.payment_method || 'Lazada',
            paymentStatus: this.mapPaymentStatus(o.statuses?.[0] || o.status || ''),
            trackingNumber: o.tracking_code || undefined,
            shippingCarrier: o.shipping_provider || undefined,
            items,
            createdAt: o.created_at || new Date().toISOString(),
            paidAt: o.payment_time || undefined,
            shippedAt: o.shipped_at || undefined,
            deliveredAt: o.delivered_at || undefined,
        }
    }

    protected mapStatus(s: string): string {
        const MAP: Record<string, string> = {
            pending: 'pending', unpaid: 'pending',
            // topack/toship/repacked là trạng thái Lazada THẬT nhưng trước đây thiếu
            // trong bảng → rơi vào nhánh mặc định 'pending' = "Chờ thanh toán".
            topack: 'confirmed', toship: 'confirmed', repacked: 'confirmed',
            packed: 'confirmed', ready_to_ship: 'confirmed', ready_to_ship_pending: 'confirmed',
            // THIẾU 'shipping' là lỗi nặng nhất: đơn ĐANG GIAO bị gắn nhãn "Chờ
            // thanh toán". Lazada dùng cả `shipped` lẫn `shipping`.
            shipped: 'shipping', shipping: 'shipping',
            delivered: 'delivered',
            completed: 'completed',
            // Đo từ log thật 01/08/2026: Lazada VN trả về 'confirmed' và
            // 'shipped_back_success' — cả hai đều KHÔNG có trong tài liệu.
            confirmed: 'confirmed',
            shipped_back: 'returned', shipped_back_success: 'returned',
            returned: 'returned', package_returned: 'returned',
            canceled: 'cancelled', cancelled: 'cancelled', failed: 'cancelled',
        }
        const key = s.toLowerCase().trim()
        const mapped = MAP[key]
        if (mapped) return mapped
        // KHÔNG ép về 'pending' nữa. Trạng thái lạ (lost, damaged_by_3pl, hoặc mã
        // mới Lazada thêm sau này) mà gắn "Chờ thanh toán" là bịa dữ liệu — đơn đã
        // giao xong vẫn nằm ở tab chờ thu tiền. Giữ nguyên mã gốc để nhìn thấy được,
        // giao diện đã có sẵn nhánh hiển thị thô khi không biết nhãn.
        if (key) console.warn(`[Lazada] trạng thái chưa có trong bảng: "${key}" — giữ nguyên mã gốc`)
        return key || 'pending'
    }

    protected mapPaymentStatus(s: string): string {
        if (['unpaid', 'pending'].includes(s.toLowerCase())) return 'unpaid'
        if (['canceled', 'failed', 'returned'].includes(s.toLowerCase())) return 'refunded'
        return 'paid'
    }
}
