import { PlatformService, PlatformCredentials, PlatformOrder, PlatformOrderItem, PlatformProduct, TokenResponse } from './base'

// ═══════════════════════════════════════════════════════════════════════════════
//  LAZADA OPEN PLATFORM
//  Docs: https://open.lazada.com/apps/doc/api?path=/order/get
// ═══════════════════════════════════════════════════════════════════════════════

const LAZADA_AUTH = 'https://auth.lazada.com'
const LAZADA_API = 'https://api.lazada.vn/rest'  // Vietnam region

export class LazadaService extends PlatformService {
    get platformName() { return 'lazada' }

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
        const params = new URLSearchParams({
            response_type: 'code',
            redirect_uri: redirectUri,
            client_id: this.credentials.apiKey,
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

    async fetchOrders(params: { since?: Date; page?: number; pageSize?: number }) {
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

    async getOrderDetail(externalOrderId: string): Promise<PlatformOrder | null> {
        const url = this.buildUrl('/order/get', { order_id: externalOrderId })
        const data = await this.httpGet(url)

        if (data.code !== '0' && data.code !== 0) return null

        const itemsUrl = this.buildUrl('/order/items/get', { order_id: externalOrderId })
        const itemsData = await this.httpGet(itemsUrl)

        return this.mapOrder(data.data, itemsData.data || [])
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
            packed: 'confirmed', ready_to_ship: 'confirmed', ready_to_ship_pending: 'confirmed',
            shipped: 'shipping', delivered: 'delivered',
            completed: 'completed', returned: 'returned',
            canceled: 'cancelled', failed: 'cancelled',
        }
        return MAP[s.toLowerCase()] || 'pending'
    }

    protected mapPaymentStatus(s: string): string {
        if (['unpaid', 'pending'].includes(s.toLowerCase())) return 'unpaid'
        if (['canceled', 'failed', 'returned'].includes(s.toLowerCase())) return 'refunded'
        return 'paid'
    }
}
