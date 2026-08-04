import { PlatformService, PlatformCredentials, PlatformOrder, PlatformOrderItem, PlatformProduct, TokenResponse } from './base'

// ═══════════════════════════════════════════════════════════════════════════════
//  TIKTOK SHOP API v202309
//  Docs: https://partner.tiktokshop.com/docv2/page/6507ead7b99d5302be949ba9
// ═══════════════════════════════════════════════════════════════════════════════

const TIKTOK_AUTH = 'https://auth.tiktok-shops.com'
const TIKTOK_API = 'https://open-api.tiktokglobalshop.com'

export class TikTokService extends PlatformService {
    get platformName() { return 'tiktok' }

    // ─── Auth ────────────────────────────────────────────────────────────────────

    private signRequest(path: string, params: Record<string, string>, body?: string): string {
        // TikTok v202309: exclude `sign` and the access-token params, sort the rest
        // alphabetically, concat as {key}{value}, prepend path, append body (non-GET,
        // non-multipart), then wrap with app_secret on both sides. HMAC-SHA256 hex.
        const sorted = Object.keys(params)
            .filter(k => !['sign', 'access_token', 'x-tts-access-token', 'app_secret'].includes(k))
            .sort()
        const paramString = sorted.map(k => `${k}${params[k]}`).join('')
        const secret = this.credentials.apiSecret
        const signBase = `${secret}${path}${paramString}${body || ''}${secret}`
        const sign = this.hmacSha256(signBase, secret)

        return sign
    }

    /**
     * Build the signed request URL plus the headers TikTok v202309 requires.
     * The access token is passed via the `x-tts-access-token` header (NOT a query
     * param) and is excluded from the signature. Empty params (e.g. an unresolved
     * shop_cipher during testConnection) are omitted so they don't poison the sign.
     */
    private buildUrl(path: string, extraParams: Record<string, string> = {}, body?: string, opts: { noShopCipher?: boolean } = {}): { url: string; headers: Record<string, string> } {
        const timestamp = Math.floor(Date.now() / 1000)
        const rawParams: Record<string, string> = {
            app_key: this.credentials.apiKey,
            timestamp: String(timestamp),
            // The /authorization/202309/shops endpoint is shop-agnostic — it must NOT
            // carry a shop_cipher, otherwise TikTok rejects the request.
            ...(this.credentials.shopId && !opts.noShopCipher ? { shop_cipher: this.credentials.shopId } : {}),
            ...extraParams,
        }
        // Drop any empty-valued params before signing/sending.
        const params: Record<string, string> = {}
        for (const [k, v] of Object.entries(rawParams)) {
            if (v !== undefined && v !== null && v !== '') params[k] = v
        }

        params.sign = this.signRequest(path, params, body)
        const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

        const headers: Record<string, string> = {}
        if (this.credentials.accessToken) headers['x-tts-access-token'] = this.credentials.accessToken

        return { url: `${TIKTOK_API}${path}?${qs}`, headers }
    }

    generateAuthUrl(redirectUri: string, state: string): string {
        // TikTok must be told where to send the auth code, otherwise it falls back to
        // the static "callback URL" registered in Partner Center and our per-channel
        // /callback endpoint is never hit (so exchangeToken never runs, token never
        // saved). Pass redirect_uri exactly like Shopee/Lazada do.
        // NOTE: this exact URL must be whitelisted under the app's callback URLs in
        // TikTok Shop Partner Center, or TikTok will reject the authorization.
        const params = new URLSearchParams({
            app_key: this.credentials.apiKey,
            state,
            redirect_uri: redirectUri,
        })
        return `${TIKTOK_AUTH}/oauth/authorize?${params}`
    }

    /**
     * TikTok Shop returns `access_token_expire_in` as an ABSOLUTE Unix timestamp
     * (e.g. 1718841600), not a relative TTL. Convert it to seconds-from-now so the
     * caller's `new Date(Date.now() + expiresIn*1000)` produces a correct expiry.
     * Falls back to a 24h TTL if the field is missing or already looks relative.
     */
    private toRelativeExpiry(rawExpire: any): number {
        const now = Math.floor(Date.now() / 1000)
        const raw = Number(rawExpire) || 0
        if (raw > now) return raw - now      // absolute epoch → relative seconds
        if (raw > 0) return raw              // already a relative TTL
        return 86400
    }

    async exchangeToken(code: string, redirectUri: string): Promise<TokenResponse> {
        // TikTok Shop's /api/v2/token/get is a GET with QUERY params (not a POST
        // body). Sending a JSON body makes TikTok reject the request, which is why
        // the token was never obtained/saved after authorization.
        const params = new URLSearchParams({
            app_key: this.credentials.apiKey,
            app_secret: this.credentials.apiSecret,
            auth_code: code,
            grant_type: 'authorized_code',
        })
        const url = `${TIKTOK_AUTH}/api/v2/token/get?${params}`
        const data = await this.httpGet(url)

        if (data.code !== 0) throw new Error(`TikTok auth error: ${data.message || data.code}`)

        const tokenData = data.data || {}
        const accessToken = tokenData.access_token

        // Log full token exchange response for debugging scope issues
        console.log('[TikTok] Token exchange response:', JSON.stringify({
            granted_scopes: tokenData.granted_scopes,
            open_id: tokenData.open_id,
            seller_name: tokenData.seller_name,
            seller_base_region: tokenData.seller_base_region,
            user_type: tokenData.user_type,
            hasAccessToken: !!accessToken,
            hasRefreshToken: !!tokenData.refresh_token,
            access_token_expire_in: tokenData.access_token_expire_in,
        }))

        // Order/product endpoints need the real shop_cipher (NOT open_id or shop_id).
        // Resolve it now via /authorization/202309/shops using the fresh access token,
        // and store it as shopId so buildUrl() can pass it as shop_cipher.
        // Fall back to open_id only if the lookup fails (sync will self-heal later).
        this.credentials.accessToken = accessToken
        let shopCipher: string | undefined
        let numericShopId: string | undefined
        try {
            const shops = await this.getAuthorizedShops()
            shopCipher = shops[0]?.cipher || shops[0]?.shop_cipher || undefined
            // Webhook payloads carry the numeric shop id, NOT the cipher — keep both
            numericShopId = shops[0]?.id ? String(shops[0].id) : undefined
        } catch (err) {
            console.error('[TikTok] Failed to resolve shop_cipher after token exchange:', err)
        }

        return {
            accessToken,
            refreshToken: tokenData.refresh_token,
            expiresIn: this.toRelativeExpiry(tokenData.access_token_expire_in),
            shopId: shopCipher || tokenData.open_id || undefined,
            platformShopId: numericShopId,
        }
    }

    /**
     * Resolve the authorized shop's `shop_cipher` from /authorization/202309/shops.
     * Order/product endpoints require shop_cipher (open_id / shop_id are NOT usable),
     * and this endpoint is itself shop-agnostic (must be called with noShopCipher).
     * Requires an access token to already be set on the credentials. Returns the first
     * shop's cipher, or undefined if no shop is returned.
     */
    async getShopCipher(): Promise<string | undefined> {
        const shops = await this.getAuthorizedShops()
        const shop = shops[0]
        return shop?.cipher || shop?.shop_cipher || undefined
    }

    /**
     * GET /authorization/202309/shops — list the shops the access token is
     * authorized for. Shop-agnostic endpoint (must be called with noShopCipher),
     * requires an access token. Returns the raw shop objects, each carrying the
     * `cipher` (a.k.a. shop_cipher) that order/product endpoints require.
     */
    async getAuthorizedShops(): Promise<any[]> {
        const path = '/authorization/202309/shops'
        console.log(`[TikTok] getAuthorizedShops: appKey=${this.credentials.apiKey}, hasToken=${!!this.credentials.accessToken}, shopId=${this.credentials.shopId || '(none)'}`)
        const { url, headers } = this.buildUrl(path, {}, undefined, { noShopCipher: true })
        console.log(`[TikTok] getAuthorizedShops URL: ${url.replace(/sign=[^&]+/, 'sign=REDACTED')}`)
        const data = await this.httpGet(url, headers)
        if (data.code !== 0) {
            console.error('[TikTok] getAuthorizedShops failed:', JSON.stringify({
                code: data.code,
                message: data.message,
                request_id: data.request_id,
                hasAccessToken: !!this.credentials.accessToken,
                appKey: this.credentials.apiKey,
            }))
            throw new Error(`TikTok getShops: [${data.code}] ${data.message || 'Unknown error'}`)
        }
        console.log(`[TikTok] getAuthorizedShops OK: ${JSON.stringify(data.data?.shops?.map((s: any) => ({ id: s.id, name: s.name, cipher: s.cipher })))}`)
        return data.data?.shops || []
    }

    async refreshAccessToken(): Promise<TokenResponse> {
        const params = new URLSearchParams({
            app_key: this.credentials.apiKey,
            app_secret: this.credentials.apiSecret,
            refresh_token: this.credentials.refreshToken || '',
            grant_type: 'refresh_token',
        })
        const url = `${TIKTOK_AUTH}/api/v2/token/refresh?${params}`
        const data = await this.httpGet(url)

        if (data.code !== 0) throw new Error(`TikTok refresh error: [${data.code}] ${data.message || 'Unknown error'}`)

        const tokenData = data.data || {}
        return {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresIn: this.toRelativeExpiry(tokenData.access_token_expire_in),
        }
    }

    // ─── Orders ──────────────────────────────────────────────────────────────────

    async fetchOrders(params: { since?: Date; until?: Date; page?: number; pageSize?: number; status?: string; pageToken?: string }) {
        const path = '/order/202309/orders/search'

        // Order endpoints REQUIRE a real shop_cipher. If we don't have one (cipher
        // resolution failed or this is an old connection that only stored open_id),
        // fail with an actionable message instead of letting TikTok reject the call
        // with an opaque error that gets masked as "Internal server error".
        if (!this.credentials.shopId) {
            throw new Error('TikTok getOrders: thiếu shop_cipher — vui lòng kết nối lại (authorize) TikTok Shop')
        }

        // v202309 orders/search: page_size / sort_field / sort_order / page_token are
        // QUERY params (signed alongside app_key/timestamp/shop_cipher), NOT body.
        // The body carries only the filter object (order_status + time range).
        const query: Record<string, string> = {
            page_size: String(Math.min(params.pageSize || 50, 100)),
            sort_field: 'create_time',
            sort_order: 'DESC',
        }
        if (params.pageToken) query.page_token = params.pageToken

        // TikTok v202309 orders/search filters by a single native order_status
        // (UNPAID, ON_HOLD, AWAITING_SHIPMENT, AWAITING_COLLECTION, IN_TRANSIT,
        // DELIVERED, COMPLETED, CANCELLED). Caller loops per-status for multiple.
        const bodyObj: any = {}
        if (params.status) {
            bodyObj.order_status = params.status
        }
        if (params.since) {
            bodyObj.create_time_ge = Math.floor(params.since.getTime() / 1000)
            bodyObj.create_time_lt = Math.floor((params.until?.getTime() ?? Date.now()) / 1000)
        }

        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, query, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)

        if (data.code !== 0) {
            console.error('[TikTok] fetchOrders failed:', JSON.stringify({
                code: data.code,
                message: data.message,
                request_id: data.request_id,
                status: params.status,
                hasShopCipher: !!this.credentials.shopId,
            }))
            throw new Error(`TikTok getOrders: [${data.code}] ${data.message || 'Unknown error'}`)
        }

        const orderList = data.data?.orders || []
        const orders: PlatformOrder[] = orderList.map((o: any) => this.mapOrder(o))
        const nextPageToken = data.data?.next_page_token || undefined

        return {
            orders,
            hasMore: !!nextPageToken,
            total: data.data?.total_count || orders.length,
            nextPageToken,
        }
    }

    /** Lỗi CẤP KẾT NỐI của TikTok: token chết, chữ ký sai, thiếu quyền — hỏi tiếp
     *  các đơn còn lại cũng hỏng y hệt. Ref: 105001/105002 token, 36004003 sign. */
    static isChannelAuthError(code: number): boolean {
        return [105001, 105002, 105004, 36004003, 36004004].includes(Number(code))
    }

    // TRƯỚC ĐÂY: `if (data.code !== 0) return null` — mọi lỗi TikTok biến thành null,
    // mà chỗ gọi lại `if (!detail) continue`. Token chết thì cả 60 đơn bị bỏ qua im
    // lặng và log ra "TikTok status refreshed: 0/60" — nhìn như sàn không có gì mới,
    // trong khi thật ra không hỏi được câu nào. Đó là lý do đơn TikTok cũ nằm mãi.
    async getOrderDetail(externalOrderId: string): Promise<PlatformOrder | null> {
        const path = `/order/202309/orders`
        const { url, headers } = this.buildUrl(path, { ids: externalOrderId })
        const data = await this.httpGet(url, headers)

        if (data.code !== 0) {
            const detail = `[${data.code}] ${data.message || 'không rõ'}`
            if (TikTokService.isChannelAuthError(data.code)) {
                throw new Error(`TikTok từ chối kênh: ${detail}`)
            }
            console.warn(`[TikTok] getOrderDetail ${externalOrderId}: ${detail}`)
            return null
        }
        const order = data.data?.orders?.[0]
        if (!order) console.warn(`[TikTok] getOrderDetail ${externalOrderId}: sàn không trả đơn nào`)
        return order ? this.mapOrder(order) : null
    }

    /**
     * NGÀY KHÁCH NHẬN HÀNG THẬT của đơn TikTok — đọc từ VẬN ĐƠN.
     * GET /fulfillment/202309/orders/{order_id}/tracking — scope seller.logistics.
     *
     * Vì sao cần: trạng thái ĐƠN của TikTok trễ hơn vận đơn. Kiện đã giao xong
     * nhưng order còn nằm ở AWAITING_COLLECTION/IN_TRANSIT — đó là đám đơn cũ
     * đọng lại ở tab "Đã xử lý". Vận đơn mới là nguồn sát thực tế.
     *
     * Trả null khi CHƯA có sự kiện giao thành công — không đoán, vì mốc này dùng
     * để chốt trạng thái đơn.
     */
    async getDeliveredTime(orderId: string, opts: { dumpVocab?: boolean } = {}): Promise<Date | null> {
        const path = `/fulfillment/202309/orders/${encodeURIComponent(orderId)}/tracking`
        const { url, headers } = this.buildUrl(path, {})
        const data = await this.httpGet(url, headers)

        if (data.code !== 0) {
            const detail = `[${data.code}] ${data.message || 'không rõ'}`
            if (TikTokService.isChannelAuthError(data.code)) throw new Error(`TikTok từ chối kênh: ${detail}`)
            throw new Error(`TikTok tracking ${orderId}: ${detail}`)
        }

        // Doc chỉ ghi `data: object` chứ không mô tả sâu → nhận nhiều tên trường.
        const events: any[] = data.data?.tracking || data.data?.tracking_list || data.data?.list || []
        if (events.length === 0) return null

        if (opts.dumpVocab) {
            const vocab = events.map(e => `${e.status ?? '?'}|${String(e.description ?? '').slice(0, 45)}`)
            console.log(`[TikTok trace] ${orderId} từ vựng sự kiện: ${JSON.stringify([...new Set(vocab)])}`)
            // Dump 03/08 cho thấy `status` toàn '?' → tên trường tôi đoán không tồn
            // tại. In tên trường THẬT + một sự kiện mẫu để chốt schema (nhất là
            // trường thời gian — đoán sai là mốc giao bị lọc mất im lặng vì ms=0).
            console.log(`[TikTok trace] ${orderId} khoá sự kiện: ${JSON.stringify(Object.keys(events[0] || {}))}` +
                ` | mẫu: ${JSON.stringify(events[0] || {}).slice(0, 220)}`)
        }

        // BÀI HỌC TỪ LAZADA (01/08/2026): dò theo chuỗi mô tả là bẫy. Chuỗi
        // "CHƯA giao thành công" CHỨA nguyên cụm "giao thành công" nhưng nghĩa
        // ngược hẳn — bên Lazada đã chốt oan 40 đơn vì đúng lỗi này.
        // Nên: ưu tiên mã trạng thái (chính xác), và nếu buộc phải đọc mô tả thì
        // phải LOẠI TRỪ phủ định trước.
        // Đo từ dữ liệu thật 03/08: sự kiện TikTok chỉ có description TIẾNG ANH
        // (trường status không tồn tại), và có chuỗi "Sorry, this package can NO
        // LONGER be delivered" — chứa 'delivered' nhưng nghĩa là HẾT ĐƯỜNG GIAO.
        // Bộ loại trừ cũ chỉ chặn phủ định tiếng Việt + fail/attempt nên lọt.
        // Schema THẬT (đo 04/08/2026): sự kiện chỉ có {action_code, description,
        // update_time_millis} — không có trường status. Mã đã quan sát:
        //   41001 đang đi giao · 31301 tới trung tâm phân loại
        //   40601 giao thất bại · 41801 hết đường giao (trả về người bán)
        // Mã "ĐÃ GIAO" CHƯA gặp trong dữ liệu (chưa đơn nào dump trúng lúc giao
        // xong) nên chưa ghim số được — tạm nhận diện qua description có chặn phủ
        // định, và LOG action_code khi khớp để ghim số ở lần chỉnh sau.
        const NEGATION = /chưa|không|thất bại|fail|unsuccessful|attempt|hoãn|hoàn|out for delivery|đang giao|no longer|cannot|can'?t|unable|undeliver|return/i
        const KNOWN_NOT_DONE = new Set([41001, 31301, 40601, 41801])
        const isDone = (e: any) => {
            const code = Number(e?.action_code ?? 0)
            if (KNOWN_NOT_DONE.has(code)) return false
            const desc = String(e?.description ?? '')
            if (NEGATION.test(desc)) return false
            const done = /\bdelivered\b|giao hàng thành công/i.test(desc)
            if (done) {
                console.log(`[TikTok trace] HỌC MÃ ĐÃ GIAO: action_code=${code} — "${desc.slice(0, 80)}"`)
            }
            return done
        }

        const ms = events
            .filter(isDone)
            .map(e => {
                // Nhận nhiều tên trường thời gian — schema thật đang chờ dump khoá
                // xác nhận; giây (10 chữ số) thì quy về mili giây.
                const raw = Number(e.update_time_millis ?? e.create_time_millis ?? e.event_time
                    ?? e.update_time ?? e.create_time ?? 0)
                return raw > 0 && raw < 1e12 ? raw * 1000 : raw
            })
            .filter(n => n > 0)
        if (ms.length === 0) return null
        // Lần giao thành công ĐẦU TIÊN (mảng có thể xếp mới→cũ)
        return new Date(Math.min(...ms))
    }

    async testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }> {
        const path = '/authorization/202309/shops'
        try {
            if (!this.credentials.accessToken) {
                return { success: false, error: 'Chưa có access token — vui lòng ủy quyền (authorize) TikTok Shop trước' }
            }

            const { url, headers } = this.buildUrl(path, {}, undefined, { noShopCipher: true })
            const data = await this.httpGet(url, headers)

            if (data.code !== 0) {
                // Surface the full TikTok error so the actual code/message is visible
                // (e.g. 105002 invalid access_token, 36004003 invalid signature, ...).
                console.error('[TikTok] testConnection failed:', JSON.stringify({
                    code: data.code,
                    message: data.message,
                    request_id: data.request_id,
                }))
                return { success: false, error: `[${data.code}] ${data.message || 'Unknown error'}` }
            }
            const shop = data.data?.shops?.[0]
            return { success: true, shopName: shop?.name || shop?.shop_name || shop?.id || 'TikTok Shop' }
        } catch (err: any) {
            console.error('[TikTok] testConnection exception:', err)
            return { success: false, error: err?.message || String(err) }
        }
    }

    /**
     * Pull the product catalog — POST /product/202309/products/search
     * (page_token cursor, max 100/page). Stock = sum of every SKU's inventory.
     */
    async fetchProducts(): Promise<{ products: PlatformProduct[]; total: number }> {
        const products: PlatformProduct[] = []
        let pageToken: string | undefined
        const bodyObj = {} // no filter → all statuses
        const bodyStr = JSON.stringify(bodyObj)

        for (let page = 0; page < 50; page++) { // Safety: max 5000 products
            const query: Record<string, string> = { page_size: '100' }
            if (pageToken) query.page_token = pageToken
            const { url, headers } = this.buildUrl('/product/202309/products/search', query, bodyStr)
            const data = await this.httpPost(url, bodyObj, headers)
            if (data.code !== 0) throw new Error(`TikTok products/search: [${data.code}] ${data.message || 'Unknown error'}`)

            for (const p of data.data?.products || []) {
                const skus = p.skus || []
                const firstSku = skus[0]
                const stock = skus.reduce((sum: number, sk: any) =>
                    sum + (sk.inventory || []).reduce((a: number, inv: any) => a + (inv.quantity || 0), 0), 0)
                products.push({
                    platformProductId: String(p.id),
                    name: p.title || 'Unnamed',
                    sku: firstSku?.seller_sku || undefined,
                    price: Number(firstSku?.price?.tax_exclusive_price || firstSku?.price?.sale_price || 0),
                    stock,
                    status: p.status || 'ACTIVATE',
                    imageUrl: p.main_images?.[0]?.thumb_urls?.[0] || p.main_images?.[0]?.urls?.[0] || undefined,
                })
            }

            pageToken = data.data?.next_page_token
            if (!pageToken) break
        }

        console.log(`[TikTok Products] Total: ${products.length} products fetched`)
        return { products, total: products.length }
    }

    /** Product detail (skus with ids) — GET /product/202309/products/{product_id}. */
    async getProductDetail(productId: string): Promise<any> {
        const { url, headers } = this.buildUrl(`/product/202309/products/${productId}`, {})
        const data = await this.httpGet(url, headers)
        if (data.code !== 0) throw new Error(`TikTok getProduct: [${data.code}] ${data.message || 'Unknown error'}`)
        return data.data
    }

    /**
     * Mã ngành hàng của 1 sản phẩm — products/search KHÔNG trả category nên phải
     * đọc từ detail.category_chains. Trả về id ngành LÁ + chuỗi tên đầy đủ
     * ("Đồ dùng nhà bếp > Dao kéo & Bộ đồ ăn > Dao"), null nếu không có.
     */
    async fetchProductCategory(productId: string): Promise<{ categoryId: string; categoryName: string } | null> {
        const detail = await this.getProductDetail(productId)
        const chains: any[] = detail?.category_chains || []
        if (!chains.length) return null
        const leaf = chains.find(c => c.is_leaf) || chains[chains.length - 1]
        return {
            categoryId: String(leaf.id),
            categoryName: chains.map(c => c.local_name).filter(Boolean).join(' > '),
        }
    }

    /**
     * Push inventory for one product — POST /product/202309/products/{id}/inventory/update.
     * TikTok needs the sku_id (not seller_sku); when the caller only knows the
     * seller_sku we resolve it via product detail first.
     */
    async updateStock(productId: string, stock: number, skuId?: string, sellerSku?: string): Promise<void> {
        let resolvedSkuId = skuId
        if (!resolvedSkuId) {
            const detail = await this.getProductDetail(productId)
            const skus = detail?.skus || []
            const match = sellerSku ? skus.find((s: any) => s.seller_sku === sellerSku) : (skus.length === 1 ? skus[0] : null)
            resolvedSkuId = match?.id ? String(match.id) : undefined
            if (!resolvedSkuId) {
                throw new Error(`TikTok: không xác định được SKU ${sellerSku ? `"${sellerSku}"` : ''} trong sản phẩm ${productId} (${skus.length} biến thể)`)
            }
        }

        const path = `/product/202309/products/${productId}/inventory/update`
        const bodyObj = { skus: [{ id: String(resolvedSkuId), inventory: [{ quantity: Math.max(0, Math.floor(stock)) }] }] }
        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)
        if (data.code !== 0) throw new Error(`TikTok inventory/update: [${data.code}] ${data.message || 'Unknown error'}`)
    }

    /**
     * Push price for one product — POST /product/202309/products/{id}/prices/update.
     * Same sku_id resolution as updateStock; amount goes as a string per TikTok spec.
     */
    async updatePrice(productId: string, price: number, skuId?: string, sellerSku?: string, currency: string = 'VND'): Promise<void> {
        let resolvedSkuId = skuId
        if (!resolvedSkuId) {
            const detail = await this.getProductDetail(productId)
            const skus = detail?.skus || []
            const match = sellerSku ? skus.find((s: any) => s.seller_sku === sellerSku) : (skus.length === 1 ? skus[0] : null)
            resolvedSkuId = match?.id ? String(match.id) : undefined
            if (!resolvedSkuId) {
                throw new Error(`TikTok: không xác định được SKU ${sellerSku ? `"${sellerSku}"` : ''} trong sản phẩm ${productId} (${skus.length} biến thể)`)
            }
        }

        const path = `/product/202309/products/${productId}/prices/update`
        const bodyObj = {
            skus: [{
                id: String(resolvedSkuId),
                price: { amount: String(Math.max(0, Math.round(price))), currency },
            }],
        }
        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)
        if (data.code !== 0) throw new Error(`TikTok prices/update: [${data.code}] ${data.message || 'Unknown error'}`)
    }

    // ─── Shipping Documents ────────────────────────────────────────────────────

    /**
     * Download the shipping label (vận đơn) for a TikTok order.
     * Flow: get order detail → extract first package_id → call fulfillment API → download PDF from doc_url.
     * TikTok API: GET /fulfillment/202309/packages/{package_id}/shipping_documents
     */
    async downloadShippingLabel(orderId: string): Promise<{ pdf: Buffer; contentType: string }> {
        // Step 1: Get order detail to find package IDs
        const orderPath = `/order/202309/orders`
        const { url: orderUrl, headers: orderHeaders } = this.buildUrl(orderPath, { ids: orderId })
        const orderData = await this.httpGet(orderUrl, orderHeaders)

        if (orderData.code !== 0) {
            throw new Error(`TikTok getOrder: [${orderData.code}] ${orderData.message || 'Unknown error'}`)
        }

        const order = orderData.data?.orders?.[0]
        if (!order) throw new Error(`Đơn TikTok ${orderId} không tồn tại`)

        // Extract package ids from the order's packages array
        const packages = order.packages || order.package_list || []
        if (packages.length === 0) {
            throw new Error(`Đơn TikTok ${orderId} chưa có kiện hàng (package). Cần ở trạng thái "Chờ gửi hàng" trở lên.`)
        }

        const packageIds = packages.map((p: any) => p.id || p.package_id).filter(Boolean)
        if (packageIds.length === 0) {
            throw new Error(`Đơn TikTok ${orderId} không có package_id. Packages: ${JSON.stringify(packages).substring(0, 200)}`)
        }

        console.log(`[TikTok AWB] Order ${orderId} → ${packageIds.length} package(s): ${packageIds.join(', ')}`)

        // Đơn 1 kiện (đa số): trả thẳng. Nhiều kiện: tải từng kiện rồi merge PDF.
        if (packageIds.length === 1) {
            return this.downloadPackageLabel(String(packageIds[0]))
        }

        const { PDFDocument } = await import('pdf-lib')
        const merged = await PDFDocument.create()
        const errors: string[] = []
        for (const pkgId of packageIds) {
            try {
                const { pdf } = await this.downloadPackageLabel(String(pkgId))
                const src = await PDFDocument.load(pdf, { ignoreEncryption: true })
                const pages = await merged.copyPages(src, src.getPageIndices())
                pages.forEach(p => merged.addPage(p))
            } catch (e: any) {
                errors.push(`Kiện ${pkgId}: ${e.message}`)
            }
        }
        if (merged.getPageCount() === 0) {
            throw new Error(`Không tải được vận đơn kiện nào. ${errors.join('; ')}`)
        }
        if (errors.length > 0) console.warn(`[TikTok AWB] ${orderId}: ${errors.join('; ')}`)
        const out = await merged.save()
        return { pdf: Buffer.from(out), contentType: 'application/pdf' }
    }

    /** Download the shipping document PDF for ONE package. */
    private async downloadPackageLabel(packageId: string): Promise<{ pdf: Buffer; contentType: string }> {
        // Step 2: Get shipping document URL.
        // Ưu tiên bản GỘP nhãn vận chuyển + phiếu danh sách sản phẩm (pack list) —
        // TikTok in chung 2 thứ trong 1 tài liệu. Region/đơn nào không hỗ trợ bản
        // gộp thì fallback về SHIPPING_LABEL thuần.
        const docPath = `/fulfillment/202309/packages/${packageId}/shipping_documents`
        // Enum hợp lệ (theo lỗi 36009004 của TikTok): SHIPPING_LABEL, PACKING_SLIP,
        // SHIPPING_LABEL_AND_PACKING_SLIP, SHIPPING_LABEL_PICTURE, HAZMAT_LABEL, INVOICE_LABEL
        const candidates: { document_type: string; document_size?: string }[] = [
            { document_type: 'SHIPPING_LABEL_AND_PACKING_SLIP', document_size: 'A6' },
            { document_type: 'SHIPPING_LABEL_AND_PACKING_SLIP' },
            { document_type: 'SHIPPING_LABEL', document_size: 'A6' },
        ]
        let docData: any = null
        for (const params of candidates) {
            const query: Record<string, string> = { document_type: params.document_type }
            if (params.document_size) query.document_size = params.document_size
            const { url: docUrl, headers: docHeaders } = this.buildUrl(docPath, query)
            docHeaders['content-type'] = 'application/json'
            docData = await this.httpGet(docUrl, docHeaders)
            if (docData.code === 0) break
            // 21042102: package already picked up by the carrier — label can no longer be printed
            if (docData.code === 21042102) {
                throw new Error('Đơn đã được đơn vị vận chuyển lấy hàng — TikTok không cho in vận đơn sau khi đã lấy hàng')
            }
            // 21042104: shipping not arranged yet — must RTS before printing
            if (docData.code === 21042104) {
                throw new Error('Đơn chưa sắp xếp giao vận chuyển — bấm "Giao vận chuyển" trước rồi mới in được vận đơn')
            }
            console.warn(`[TikTok AWB] ${params.document_type}${params.document_size ? '/' + params.document_size : ''} failed: [${docData.code}] ${docData.message} — trying next variant`)
        }

        if (!docData || docData.code !== 0) {
            throw new Error(`TikTok shipping document: [${docData?.code}] ${docData?.message || 'Unknown error'}`)
        }

        const pdfUrl = docData.data?.doc_url
        if (!pdfUrl) {
            throw new Error(`TikTok không trả về URL vận đơn cho package ${packageId}`)
        }

        console.log(`[TikTok AWB] doc_url: ${pdfUrl.substring(0, 80)}...`)

        // Step 3: Download the PDF from the URL
        const pdfRes = await fetch(pdfUrl)
        if (!pdfRes.ok) throw new Error(`Lỗi tải vận đơn TikTok: HTTP ${pdfRes.status}`)

        const arrayBuf = await pdfRes.arrayBuffer()
        const contentType = pdfRes.headers.get('content-type') || 'application/pdf'
        console.log(`[TikTok AWB] Downloaded ${arrayBuf.byteLength}b, type=${contentType}`)

        return { pdf: Buffer.from(arrayBuf), contentType }
    }

    // ─── Seller actions (ánh xạ nút bấm → hành động THẬT trên sàn) ──────────────

    /**
     * Arrange shipment (RTS) for a package.
     * POST /fulfillment/202309/packages/{package_id}/ship — body { handover_method }.
     */
    async shipPackage(packageId: string, handoverMethod: 'PICKUP' | 'DROP_OFF' = 'PICKUP'): Promise<void> {
        const path = `/fulfillment/202309/packages/${packageId}/ship`
        const bodyObj = { handover_method: handoverMethod }
        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)
        if (data.code !== 0) {
            throw new Error(`TikTok shipPackage: [${data.code}] ${data.message || 'Unknown error'}`)
        }
    }

    /** Resolve ALL of the order's packages and arrange their shipment (RTS). */
    async shipOrder(orderId: string): Promise<void> {
        const { url, headers } = this.buildUrl('/order/202309/orders', { ids: orderId })
        const data = await this.httpGet(url, headers)
        if (data.code !== 0) throw new Error(`TikTok getOrder: [${data.code}] ${data.message || 'Unknown error'}`)
        const order = data.data?.orders?.[0]
        if (!order) throw new Error(`Đơn TikTok ${orderId} không tồn tại`)
        const packages = order.packages || order.package_list || []
        const packageIds = packages.map((p: any) => p.id || p.package_id).filter(Boolean)
        if (packageIds.length === 0) throw new Error('Đơn chưa có kiện hàng (package) — TikTok chưa sẵn sàng giao vận chuyển')

        // Đơn nhiều kiện: RTS từng kiện. Kiện đã RTS trước đó lỗi thì bỏ qua,
        // chỉ throw khi TẤT CẢ các kiện đều thất bại.
        const errors: string[] = []
        for (const pkgId of packageIds) {
            try {
                await this.shipPackage(String(pkgId))
            } catch (e: any) {
                errors.push(`Kiện ${pkgId}: ${e.message}`)
            }
        }
        if (errors.length === packageIds.length) {
            throw new Error(errors.join('; '))
        }
        if (errors.length > 0) {
            console.warn(`[TikTok RTS] ${orderId}: ${errors.length}/${packageIds.length} kiện lỗi — ${errors.join('; ')}`)
        }
    }

    /**
     * Seller-initiated order cancellation.
     * POST /return_refund/202309/cancellations — body { order_id, cancel_reason }.
     */
    async cancelOrder(orderId: string, cancelReason = 'seller_cancel_reason_out_of_stock'): Promise<void> {
        const path = '/return_refund/202309/cancellations'
        const bodyObj = { order_id: orderId, cancel_reason: cancelReason }
        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)
        if (data.code !== 0) {
            throw new Error(`TikTok cancelOrder: [${data.code}] ${data.message || 'Unknown error'}`)
        }
    }

    /**
     * Approve a return/refund request — POST /return_refund/202309/returns/{return_id}/approve.
     */
    async approveReturn(returnId: string): Promise<void> {
        const path = `/return_refund/202309/returns/${returnId}/approve`
        const bodyObj = { decision: 'APPROVE_RETURN' }
        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)
        if (data.code !== 0) {
            throw new Error(`TikTok approveReturn: [${data.code}] ${data.message || 'Unknown error'}`)
        }
    }

    /**
     * Reject a return/refund request — POST /return_refund/202309/returns/{return_id}/reject.
     * TikTok requires a reject_reason from its own catalog, so we look up the
     * available reasons for this return first and use the given/first one.
     */
    async rejectReturn(returnId: string, comment?: string, rejectReason?: string): Promise<void> {
        let reason = rejectReason
        if (!reason) {
            const { url: rUrl, headers: rHeaders } = this.buildUrl('/return_refund/202309/reject_reasons', {
                return_or_cancel_id: returnId,
                locale: 'vi-VN',
            })
            const reasonsData = await this.httpGet(rUrl, rHeaders)
            reason = reasonsData.data?.reasons?.[0]?.name
            if (!reason) {
                throw new Error(`TikTok: không lấy được danh sách lý do từ chối cho phiếu ${returnId}${reasonsData.code !== 0 ? ` ([${reasonsData.code}] ${reasonsData.message})` : ''}`)
            }
        }

        const path = `/return_refund/202309/returns/${returnId}/reject`
        const bodyObj: any = { decision: 'REJECT_RETURN', reject_reason: reason }
        if (comment) bodyObj.comment = comment
        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)
        if (data.code !== 0) {
            throw new Error(`TikTok rejectReturn: [${data.code}] ${data.message || 'Unknown error'}`)
        }
    }

    /**
     * Real settlement for an order — GET /finance/202309/orders/{order_id}/statement_transactions.
     * Amounts come back as strings; fee = revenue - settlement when no explicit
     * fee field is present. Returns null when the order isn't settled yet.
     */
    async getOrderSettlement(orderId: string): Promise<{ settlementAmount: number; feeAmount: number; revenueAmount: number } | null> {
        const path = `/finance/202309/orders/${orderId}/statement_transactions`
        const { url, headers } = this.buildUrl(path, {})
        const data = await this.httpGet(url, headers)
        if (data.code !== 0) {
            // Đơn chưa được đối soát/quyết toán — không phải lỗi cứng
            console.warn(`[TikTok Settlement] ${orderId}: [${data.code}] ${data.message}`)
            return null
        }

        const txs = data.data?.statement_transactions || []
        if (txs.length === 0) return null

        let settlement = 0, revenue = 0, fee = 0
        for (const t of txs) {
            settlement += Number(t.settlement_amount || 0)
            revenue += Number(t.revenue_amount || 0)
            fee += Math.abs(Number(t.fee_amount ?? t.fee_and_tax_amount ?? t.fee_tax_amount ?? 0))
        }
        if (fee === 0 && revenue > settlement) fee = revenue - settlement
        return { settlementAmount: settlement, feeAmount: fee, revenueAmount: revenue }
    }

    // ─── Customer Service Chat (IM) ─────────────────────────────────────────────
    // Docs: /customer_service/202309/* — message content là chuỗi JSON.

    /** Parse TikTok IM message content (JSON string) to display text + image. */
    private parseImContent(type: string, raw: string): { content: string; imageUrl?: string } {
        let parsed: any = {}
        try { parsed = JSON.parse(raw || '{}') } catch { }
        const t = (type || '').toUpperCase()
        if (t === 'TEXT') return { content: parsed.content || '' }
        if (t === 'IMAGE') return { content: '[Hình ảnh]', imageUrl: parsed.url || parsed.image_url || '' }
        if (t === 'ORDER_CARD') return { content: `[Đơn hàng #${parsed.order_id || ''}]` }
        if (t === 'PRODUCT_CARD') return { content: `[Sản phẩm: ${parsed.title || parsed.product_id || ''}]` }
        return { content: parsed.content || `[${type}]` }
    }

    /**
     * List chat conversations — GET /customer_service/202309/conversations.
     * Trả về shape giống ShopeeService.getConversationList để route dùng chung.
     */
    async getConversationList(params: { pageSize?: number } = {}): Promise<{
        conversations: Array<{
            conversationId: string
            toId: number | string
            toName: string
            toAvatar: string
            lastMessage: string
            lastMessageType: string
            lastSenderId: number | string
            unreadCount: number
            pinned: boolean
            lastMessageTimestamp: number
            lastReadMessageId: string
        }>
        hasMore: boolean
        nextOffset: string
    }> {
        const all: any[] = []
        let pageToken: string | undefined
        for (let page = 0; page < 10; page++) {
            const query: Record<string, string> = { page_size: String(params.pageSize || 20) }
            if (pageToken) query.page_token = pageToken
            const { url, headers } = this.buildUrl('/customer_service/202309/conversations', query)
            const data = await this.httpGet(url, headers)
            if (data.code !== 0) throw new Error(`TikTok conversations: [${data.code}] ${data.message || 'Unknown error'}`)
            all.push(...(data.data?.conversations || []))
            pageToken = data.data?.next_page_token
            if (!pageToken) break
        }

        const conversations = all.map((c: any) => {
            const buyer = (c.participants || []).find((p: any) => (p.role || '').toUpperCase() !== 'SHOP') || {}
            const latest = c.latest_message || {}
            const { content } = this.parseImContent(latest.type, latest.content)
            // create_time: epoch giây (chuẩn hóa nếu sàn trả ms)
            let ts = Number(latest.create_time || c.create_time || 0)
            if (ts > 1e12) ts = Math.floor(ts / 1000)
            return {
                conversationId: String(c.id || ''),
                toId: buyer.im_user_id || '',
                toName: buyer.nickname || 'Khách TikTok',
                toAvatar: buyer.avatar || '',
                lastMessage: content,
                lastMessageType: (latest.type || 'TEXT').toLowerCase(),
                lastSenderId: latest.sender?.im_user_id || '',
                unreadCount: c.unread_count || 0,
                pinned: false,
                lastMessageTimestamp: ts,
                lastReadMessageId: '',
            }
        })
        conversations.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
        return { conversations, hasMore: false, nextOffset: '' }
    }

    /**
     * Messages of one conversation — GET /customer_service/202309/conversations/{id}/messages.
     */
    async getMessages(conversationId: string, params: { pageSize?: number; offset?: string } = {}): Promise<{
        messages: Array<{
            messageId: string
            messageType: string
            content: string
            imageUrl?: string
            fromId: number | string
            fromName: string
            fromRole: string
            createdTimestamp: number
            sourceContent?: any
        }>
        hasMore: boolean
        nextOffset: string
    }> {
        const query: Record<string, string> = { page_size: String(params.pageSize || 25), sort_order: 'DESC' }
        if (params.offset) query.page_token = params.offset
        const { url, headers } = this.buildUrl(`/customer_service/202309/conversations/${conversationId}/messages`, query)
        const data = await this.httpGet(url, headers)
        if (data.code !== 0) throw new Error(`TikTok messages: [${data.code}] ${data.message || 'Unknown error'}`)

        const messages = (data.data?.messages || []).map((m: any) => {
            const { content, imageUrl } = this.parseImContent(m.type, m.content)
            let ts = Number(m.create_time || 0)
            if (ts > 1e12) ts = Math.floor(ts / 1000)
            return {
                messageId: String(m.id || ''),
                messageType: (m.type || 'TEXT').toLowerCase(),
                content,
                imageUrl,
                fromId: m.sender?.im_user_id || '',
                fromName: m.sender?.nickname || '',
                fromRole: (m.sender?.role || '').toUpperCase(), // SHOP | BUYER
                createdTimestamp: ts,
                sourceContent: m.content,
            }
        })
        return {
            messages,
            hasMore: !!data.data?.next_page_token,
            nextOffset: String(data.data?.next_page_token || ''),
        }
    }

    /**
     * Send a text message — POST /customer_service/202309/conversations/{id}/messages.
     */
    async sendMessage(conversationId: string, content: string): Promise<{ messageId: string; conversationId: string }> {
        const path = `/customer_service/202309/conversations/${conversationId}/messages`
        const bodyObj = { type: 'TEXT', content: JSON.stringify({ content }) }
        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)
        if (data.code !== 0) throw new Error(`TikTok sendMessage: [${data.code}] ${data.message || 'Unknown error'}`)
        return { messageId: String(data.data?.message_id || ''), conversationId }
    }

    /**
     * Mark a conversation as read — POST /customer_service/202309/conversations/{id}/messages/read.
     */
    async readConversation(conversationId: string): Promise<void> {
        const path = `/customer_service/202309/conversations/${conversationId}/messages/read`
        const bodyObj = {}
        const bodyStr = JSON.stringify(bodyObj)
        const { url, headers } = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj, headers)
        if (data.code !== 0) throw new Error(`TikTok readConversation: [${data.code}] ${data.message || 'Unknown error'}`)
    }

    // ─── Returns / Refunds ──────────────────────────────────────────────────────

    /**
     * Fetch return/refund requests via POST /return_refund/202309/returns/search.
     * Returns the same record shape as ShopeeService.fetchReturns so the
     * /channels/:id/sync-returns route can treat both platforms uniformly.
     */
    async fetchReturns(params: { since?: Date; until?: Date }) {
        if (!this.credentials.shopId) {
            throw new Error('TikTok getReturns: thiếu shop_cipher — vui lòng kết nối lại (authorize) TikTok Shop')
        }
        const path = '/return_refund/202309/returns/search'
        const all: any[] = []
        let pageToken: string | undefined
        // Trần cũ 10 trang (500 phiếu) VỨT LẶNG LẼ phần dư khi còn next_page_token.
        // Nâng 40 trang (2000) + gắn cờ truncated khi vẫn còn — cùng bệnh với Shopee.
        const PAGE_CAP = 40
        for (let i = 0; i < PAGE_CAP; i++) {
            const query: Record<string, string> = { page_size: '50' }
            if (pageToken) query.page_token = pageToken
            const bodyObj: any = {}
            if (params.since) {
                bodyObj.create_time_ge = Math.floor(params.since.getTime() / 1000)
                // Mốc kết thúc chọn được (mặc định = bây giờ)
                bodyObj.create_time_le = Math.min(
                    params.until ? Math.floor(params.until.getTime() / 1000) : Math.floor(Date.now() / 1000),
                    Math.floor(Date.now() / 1000),
                )
            }
            const bodyStr = JSON.stringify(bodyObj)
            const { url, headers } = this.buildUrl(path, query, bodyStr)
            const data = await this.httpPost(url, bodyObj, headers)
            if (data.code !== 0) {
                throw new Error(`TikTok getReturns: [${data.code}] ${data.message || 'Unknown error'}`)
            }
            all.push(...(data.data?.return_orders || []))
            pageToken = data.data?.next_page_token || undefined
            if (!pageToken) break
        }
        const out: any = all.map(r => this.mapReturn(r))
        if (pageToken) {
            out.truncated = true
            console.warn(`[TikTok Returns] CHẠM TRẦN ${PAGE_CAP} trang (${all.length} phiếu) mà sàn vẫn còn — có phiếu bị sót, kéo lại khoảng hẹp hơn`)
        }
        return out
    }

    private mapReturn(r: any) {
        // TikTok v202309 return_status → internal status (same vocab as ShopeeService.mapReturn)
        const RETURN_STATUS_MAP: Record<string, string> = {
            RETURN_OR_REFUND_REQUEST_PENDING: 'pending',
            AWAITING_BUYER_SHIP: 'approved',
            BUYER_SHIPPED_ITEM: 'approved',
            REJECT_RECEIVE_PACKAGE: 'rejected',
            REFUND_OR_RETURN_REQUEST_REJECT: 'rejected',
            RETURN_OR_REFUND_REQUEST_CANCEL: 'rejected',
            RETURN_OR_REFUND_REQUEST_SUCCESS: 'refunded',
            RETURN_OR_REFUND_REQUEST_COMPLETE: 'refunded',
        }
        const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
        return {
            returnSn: String(r.return_id || ''),
            orderSn: String(r.order_id || ''),
            status: RETURN_STATUS_MAP[r.return_status] || 'pending',
            platformStatus: r.return_status || '',
            reason: r.return_reason_text || r.return_reason || '',
            textReason: r.return_reason_text || '',
            refundAmount: num(r.refund_amount?.refund_total),
            currency: r.refund_amount?.currency || 'VND',
            trackingNumber: r.return_tracking_number || '',
            images: [],
            items: (r.return_line_items || []).map((li: any) => ({
                itemId: String(li.order_line_item_id || li.return_line_item_id || ''),
                name: li.product_name || li.sku_name || '',
                modelName: li.sku_name || '',
                amount: 1, // TikTok return_line_items là từng đơn vị sản phẩm
                itemPrice: num(li.refund_amount?.refund_total),
            })),
            createTime: r.create_time ? new Date(r.create_time * 1000) : new Date(),
            updateTime: r.update_time ? new Date(r.update_time * 1000) : new Date(),
            needReturn: r.return_type === 'RETURN_AND_REFUND',
            disputeReason: '',
        }
    }

    // ─── Mappers ─────────────────────────────────────────────────────────────────

    /**
     * ISO 4217 currencies with NO minor unit (zero decimal places). TikTok Shop
     * returns amounts in the smallest currency unit for currencies that HAVE a
     * minor unit (USD/EUR → cents, divide by 100), but for these currencies the
     * value is already the full amount — dividing would give 1/100th the real value
     * (e.g. a 500,000 VND order showing as 5,000 VND).
     */
    private static readonly ZERO_DECIMAL_CURRENCIES = new Set([
        'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
        'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
    ])

    /** Minor-unit divisor for a currency: 1 for zero-decimal (VND, JPY, …), else 100. */
    private minorUnitFactor(currency?: string): number {
        const code = (currency || '').toUpperCase()
        return TikTokService.ZERO_DECIMAL_CURRENCIES.has(code) ? 1 : 100
    }

    /** Parse a TikTok money string into the major currency unit, currency-aware. */
    private toMajor(raw: any, factor: number): number {
        return parseFloat(raw || '0') / factor
    }

    private mapOrder(o: any): PlatformOrder {
        const addr = o.recipient_address || {}
        const payment = o.payment || {}
        // TikTok returns amounts in the smallest unit for minor-unit currencies
        // (USD/EUR cents) but as the full amount for zero-decimal ones (VND, JPY…).
        // Resolve the order currency once and convert all money fields accordingly.
        const currency = payment.currency || o.currency || o.line_items?.[0]?.currency
        const factor = this.minorUnitFactor(currency)

        const items: PlatformOrderItem[] = (o.line_items || o.order_line_list || []).map((item: any) => ({
            externalItemId: item.id || item.order_line_id,
            productName: item.product_name || item.sku_name || '',
            sku: item.seller_sku || item.sku_id || '',
            quantity: item.quantity || 1,
            unitPrice: this.toMajor(item.sale_price || item.original_price, factor),
            discount: (this.toMajor(item.platform_discount, factor) + this.toMajor(item.seller_discount, factor)),
            lineTotal: this.toMajor(item.sale_price, factor) * (item.quantity || 1),
        }))

        // TikTok v202309 returns `status` as a string enum (COMPLETED, IN_TRANSIT,
        // AWAITING_SHIPMENT, etc.). Earlier API versions used numeric codes. Accept
        // both `status` and `order_status` for resilience.
        const rawStatus = (o.status || o.order_status)?.toString() || ''

        return {
            externalOrderId: o.id || o.order_id,
            orderNumber: `TIK-${o.id || o.order_id}`,
            platform: 'tiktok',
            status: this.mapStatus(rawStatus),
            externalStatus: rawStatus,
            customerName: addr.name || addr.full_name || 'Khách TikTok',
            customerPhone: addr.phone_number || addr.phone || '',
            shippingAddress: [addr.address_detail, addr.district, addr.city, addr.region_code].filter(Boolean).join(', '),
            subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
            discount: 0,
            shippingFee: this.toMajor(payment.shipping_fee || o.shipping_fee, factor),
            total: items.reduce((s, i) => s + i.lineTotal, 0),
            paymentMethod: payment.payment_method || 'TikTok',
            paymentStatus: this.mapPaymentStatus(rawStatus),
            trackingNumber: o.tracking_number || undefined,
            shippingCarrier: o.shipping_provider || o.shipping_provider_id || undefined,
            items,
            createdAt: o.create_time ? new Date(o.create_time * 1000).toISOString() : new Date().toISOString(),
            paidAt: o.paid_time ? new Date(o.paid_time * 1000).toISOString() : undefined,
            shippedAt: o.rts_time ? new Date(o.rts_time * 1000).toISOString() : undefined,
            deliveredAt: o.delivery_time ? new Date(o.delivery_time * 1000).toISOString() : undefined,
        }
    }

    protected mapStatus(s: string): string {
        // Giữ NGUYÊN trạng thái gốc TikTok (UPPERCASE) — frontend tabs/badge và
        // stats backend đều thiết kế theo native status (như Shopee). Quy đổi về
        // lowercase trước đây làm AWAITING_COLLECTION (chờ lấy hàng) rơi nhầm
        // tab "Chờ xử lý" thay vì "Đã xử lý". Chỉ dịch mã số API cũ → enum.
        const NUMERIC: Record<string, string> = {
            '100': 'UNPAID', '105': 'ON_HOLD',
            '111': 'AWAITING_SHIPMENT', '112': 'AWAITING_COLLECTION',
            '114': 'PARTIALLY_SHIPPING', '121': 'IN_TRANSIT',
            '122': 'DELIVERED', '130': 'COMPLETED', '140': 'CANCELLED',
        }
        return NUMERIC[s] || s || 'UNPAID'
    }

    protected mapPaymentStatus(s: string): string {
        if (['100', 'UNPAID'].includes(s)) return 'unpaid'
        if (['140', 'CANCELLED'].includes(s)) return 'refunded'
        return 'paid'
    }
}
