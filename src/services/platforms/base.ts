import crypto from 'crypto'

// ═══════════════════════════════════════════════════════════════════════════════
//  BASE PLATFORM SERVICE — Abstract class for e-commerce platform integrations
// ═══════════════════════════════════════════════════════════════════════════════

export interface PlatformCredentials {
    apiKey: string        // App ID / Partner ID
    apiSecret: string     // App Secret / Partner Key
    accessToken?: string
    refreshToken?: string
    shopId?: string
    shopUrl?: string
}

export interface PlatformOrder {
    externalOrderId: string
    orderNumber: string
    platform: string
    status: string            // mapped to our internal status
    externalStatus: string    // original platform status
    customerName: string
    customerPhone?: string
    customerEmail?: string
    shippingAddress?: string
    subtotal: number
    discount: number
    shippingFee: number
    total: number
    paymentMethod?: string
    paymentStatus: string     // unpaid, paid, refunded
    trackingNumber?: string
    shippingCarrier?: string
    items: PlatformOrderItem[]
    createdAt: string
    paidAt?: string
    shippedAt?: string
    deliveredAt?: string
}

export interface PlatformOrderItem {
    externalItemId?: string
    productName: string
    sku?: string
    quantity: number
    unitPrice: number
    discount: number
    lineTotal: number
}

export interface PlatformProduct {
    platformProductId: string
    name: string
    sku?: string
    price: number
    stock: number
    status: string
    imageUrl?: string
}

export interface TokenResponse {
    accessToken: string
    refreshToken: string
    expiresIn: number     // seconds
    shopId?: string
}

export interface SyncResult {
    success: boolean
    ordersImported: number
    ordersUpdated: number
    errors: string[]
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ABSTRACT BASE CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export abstract class PlatformService {
    protected credentials: PlatformCredentials

    constructor(credentials: PlatformCredentials) {
        this.credentials = credentials
    }

    /** Platform name identifier */
    abstract get platformName(): string

    /** Generate OAuth2 authorization URL */
    abstract generateAuthUrl(redirectUri: string, state: string): string

    /** Exchange auth code for access/refresh tokens */
    abstract exchangeToken(code: string, redirectUri: string): Promise<TokenResponse>

    /** Refresh expired access token */
    abstract refreshAccessToken(): Promise<TokenResponse>

    /** Fetch orders list from platform (since lastSync or date range) */
    abstract fetchOrders(params: {
        since?: Date
        page?: number
        pageSize?: number
    }): Promise<{ orders: PlatformOrder[]; hasMore: boolean; total: number }>

    /** Fetch product catalog from platform */
    abstract fetchProducts(): Promise<{ products: PlatformProduct[]; total: number }>

    /** Get single order details */
    abstract getOrderDetail(externalOrderId: string): Promise<PlatformOrder | null>

    /** Test if credentials are valid */
    abstract testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }>

    // ─── Shared utilities ────────────────────────────────────────────────────────

    protected hmacSha256(data: string, secret: string): string {
        return crypto.createHmac('sha256', secret).update(data).digest('hex')
    }

    protected async httpGet(url: string, headers: Record<string, string> = {}): Promise<any> {
        const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json', ...headers } })
        return res.json()
    }

    protected async httpPost(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        })
        return res.json()
    }

    /** Map platform-specific status to our internal status */
    protected abstract mapStatus(platformStatus: string): string

    /** Map platform-specific payment status */
    protected abstract mapPaymentStatus(platformStatus: string): string
}
