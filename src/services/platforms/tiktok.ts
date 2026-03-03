import { PlatformService, PlatformCredentials, PlatformOrder, PlatformOrderItem, TokenResponse } from './base'

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
        const sorted = Object.keys(params)
            .filter(k => !['sign', 'access_token', 'app_secret'].includes(k))
            .sort()
        const paramString = sorted.map(k => `${k}${params[k]}`).join('')
        const signBase = `${this.credentials.apiSecret}${path}${paramString}${body || ''}${this.credentials.apiSecret}`
        return this.hmacSha256(signBase, this.credentials.apiSecret)
    }

    private buildUrl(path: string, extraParams: Record<string, string> = {}, body?: string): string {
        const timestamp = Math.floor(Date.now() / 1000)
        const params: Record<string, string> = {
            app_key: this.credentials.apiKey,
            timestamp: String(timestamp),
            shop_id: this.credentials.shopId || '',
            version: '202309',
            ...extraParams,
        }
        const sign = this.signRequest(path, params, body)
        params.sign = sign
        if (this.credentials.accessToken) params.access_token = this.credentials.accessToken
        const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
        return `${TIKTOK_API}${path}?${qs}`
    }

    generateAuthUrl(redirectUri: string, state: string): string {
        const params = new URLSearchParams({
            app_key: this.credentials.apiKey,
            state,
        })
        return `${TIKTOK_AUTH}/oauth/authorize?${params}`
    }

    async exchangeToken(code: string, redirectUri: string): Promise<TokenResponse> {
        const url = `${TIKTOK_AUTH}/api/v2/token/get`
        const body = {
            app_key: this.credentials.apiKey,
            app_secret: this.credentials.apiSecret,
            auth_code: code,
            grant_type: 'authorized_code',
        }
        const data = await this.httpPost(url, body)

        if (data.code !== 0) throw new Error(`TikTok auth error: ${data.message || data.code}`)

        const tokenData = data.data || {}
        return {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresIn: tokenData.access_token_expire_in || 86400,
            shopId: tokenData.open_id || undefined,
        }
    }

    async refreshAccessToken(): Promise<TokenResponse> {
        const url = `${TIKTOK_AUTH}/api/v2/token/refresh`
        const body = {
            app_key: this.credentials.apiKey,
            app_secret: this.credentials.apiSecret,
            refresh_token: this.credentials.refreshToken,
            grant_type: 'refresh_token',
        }
        const data = await this.httpPost(url, body)

        if (data.code !== 0) throw new Error(`TikTok refresh error: ${data.message}`)

        const tokenData = data.data || {}
        return {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresIn: tokenData.access_token_expire_in || 86400,
        }
    }

    // ─── Orders ──────────────────────────────────────────────────────────────────

    async fetchOrders(params: { since?: Date; page?: number; pageSize?: number }) {
        const path = '/order/202309/orders/search'
        const bodyObj: any = {
            page_size: Math.min(params.pageSize || 50, 100),
            sort_field: 'CREATE_TIME',
            sort_order: 'DESC',
        }
        if (params.since) {
            bodyObj.create_time_ge = Math.floor(params.since.getTime() / 1000)
            bodyObj.create_time_lt = Math.floor(Date.now() / 1000)
        }
        if (params.page && params.page > 1) {
            bodyObj.cursor = String((params.page - 1) * (params.pageSize || 50))
        }

        const bodyStr = JSON.stringify(bodyObj)
        const url = this.buildUrl(path, {}, bodyStr)
        const data = await this.httpPost(url, bodyObj)

        if (data.code !== 0) throw new Error(`TikTok getOrders: ${data.message}`)

        const orderList = data.data?.orders || []
        const orders: PlatformOrder[] = orderList.map((o: any) => this.mapOrder(o))

        return {
            orders,
            hasMore: data.data?.next_page_token ? true : false,
            total: data.data?.total_count || orders.length,
        }
    }

    async getOrderDetail(externalOrderId: string): Promise<PlatformOrder | null> {
        const path = `/order/202309/orders`
        const url = this.buildUrl(path, { ids: externalOrderId })
        const data = await this.httpGet(url)

        if (data.code !== 0) return null
        const order = data.data?.orders?.[0]
        return order ? this.mapOrder(order) : null
    }

    async testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }> {
        try {
            const path = '/authorization/202309/shops'
            const url = this.buildUrl(path)
            const data = await this.httpGet(url)

            if (data.code !== 0) return { success: false, error: data.message || 'Unknown error' }
            const shop = data.data?.shops?.[0]
            return { success: true, shopName: shop?.shop_name || shop?.shop_id || 'TikTok Shop' }
        } catch (err: any) {
            return { success: false, error: err.message }
        }
    }

    // ─── Mappers ─────────────────────────────────────────────────────────────────

    private mapOrder(o: any): PlatformOrder {
        const addr = o.recipient_address || {}
        const items: PlatformOrderItem[] = (o.line_items || o.order_line_list || []).map((item: any) => ({
            externalItemId: item.id || item.order_line_id,
            productName: item.product_name || item.sku_name || '',
            sku: item.seller_sku || item.sku_id || '',
            quantity: item.quantity || 1,
            unitPrice: parseFloat(item.sale_price || item.original_price || '0') / 100, // TikTok uses cents
            discount: (parseFloat(item.platform_discount || '0') + parseFloat(item.seller_discount || '0')) / 100,
            lineTotal: parseFloat(item.sale_price || '0') * (item.quantity || 1) / 100,
        }))

        const payment = o.payment || {}

        return {
            externalOrderId: o.id || o.order_id,
            orderNumber: `TIK-${o.id || o.order_id}`,
            platform: 'tiktok',
            status: this.mapStatus(o.status?.toString() || ''),
            externalStatus: o.status?.toString() || '',
            customerName: addr.name || addr.full_name || 'Khách TikTok',
            customerPhone: addr.phone_number || addr.phone || '',
            shippingAddress: [addr.address_detail, addr.district, addr.city, addr.region_code].filter(Boolean).join(', '),
            subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
            discount: (parseFloat(payment.platform_discount || '0') + parseFloat(payment.seller_discount || '0')) / 100,
            shippingFee: parseFloat(payment.shipping_fee || o.shipping_fee || '0') / 100,
            total: parseFloat(payment.total_amount || o.payment_info?.total_amount || '0') / 100,
            paymentMethod: payment.payment_method || 'TikTok',
            paymentStatus: this.mapPaymentStatus(o.status?.toString() || ''),
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
        const MAP: Record<string, string> = {
            '100': 'pending', UNPAID: 'pending',
            '105': 'pending', ON_HOLD: 'pending',
            '111': 'confirmed', AWAITING_SHIPMENT: 'confirmed',
            '112': 'confirmed', AWAITING_COLLECTION: 'confirmed',
            '114': 'processing', PARTIALLY_SHIPPING: 'processing',
            '121': 'shipping', IN_TRANSIT: 'shipping',
            '122': 'delivered', DELIVERED: 'delivered',
            '130': 'completed', COMPLETED: 'completed',
            '140': 'cancelled', CANCELLED: 'cancelled',
        }
        return MAP[s] || 'pending'
    }

    protected mapPaymentStatus(s: string): string {
        if (['100', 'UNPAID'].includes(s)) return 'unpaid'
        if (['140', 'CANCELLED'].includes(s)) return 'refunded'
        return 'paid'
    }
}
