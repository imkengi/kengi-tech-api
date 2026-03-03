import { PlatformService, PlatformCredentials, PlatformOrder, PlatformOrderItem, TokenResponse } from './base'

// ═══════════════════════════════════════════════════════════════════════════════
//  SHOPEE OPEN PLATFORM v2.0
//  Docs: https://open.shopee.com/documents/v2/v2.order
// ═══════════════════════════════════════════════════════════════════════════════

const SHOPEE_HOST = 'https://partner.shopeemobile.com'
const SHOPEE_API = `${SHOPEE_HOST}/api/v2`

export class ShopeeService extends PlatformService {
    get platformName() { return 'shopee' }

    // ─── Auth ────────────────────────────────────────────────────────────────────

    private sign(path: string, timestamp: number): string {
        const { apiKey: partnerId, apiSecret } = this.credentials
        const baseString = `${partnerId}${path}${timestamp}`
        return this.hmacSha256(baseString, apiSecret)
    }

    private signWithToken(path: string, timestamp: number): string {
        const { apiKey: partnerId, apiSecret, accessToken, shopId } = this.credentials
        const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`
        return this.hmacSha256(baseString, apiSecret)
    }

    generateAuthUrl(redirectUri: string, state: string): string {
        const timestamp = Math.floor(Date.now() / 1000)
        const path = '/api/v2/shop/auth_partner'
        const sign = this.sign(path, timestamp)
        const params = new URLSearchParams({
            partner_id: this.credentials.apiKey,
            timestamp: String(timestamp),
            sign,
            redirect: redirectUri,
        })
        return `${SHOPEE_HOST}${path}?${params}`
    }

    async exchangeToken(code: string, redirectUri: string): Promise<TokenResponse> {
        const timestamp = Math.floor(Date.now() / 1000)
        const path = '/api/v2/auth/token/get'
        const sign = this.sign(path, timestamp)

        const url = `${SHOPEE_API}/auth/token/get?partner_id=${this.credentials.apiKey}&timestamp=${timestamp}&sign=${sign}`
        const body = {
            code,
            shop_id: parseInt(this.credentials.shopId || '0'),
            partner_id: parseInt(this.credentials.apiKey),
        }
        const data = await this.httpPost(url, body)

        if (data.error) throw new Error(`Shopee auth error: ${data.error} - ${data.message}`)

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expire_in,
            shopId: String(data.shop_id || this.credentials.shopId),
        }
    }

    async refreshAccessToken(): Promise<TokenResponse> {
        const timestamp = Math.floor(Date.now() / 1000)
        const path = '/api/v2/auth/access_token/get'
        const sign = this.sign(path, timestamp)

        const url = `${SHOPEE_API}/auth/access_token/get?partner_id=${this.credentials.apiKey}&timestamp=${timestamp}&sign=${sign}`
        const body = {
            refresh_token: this.credentials.refreshToken,
            shop_id: parseInt(this.credentials.shopId || '0'),
            partner_id: parseInt(this.credentials.apiKey),
        }
        const data = await this.httpPost(url, body)

        if (data.error) throw new Error(`Shopee refresh error: ${data.error} - ${data.message}`)

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expire_in,
            shopId: String(data.shop_id),
        }
    }

    // ─── Orders ──────────────────────────────────────────────────────────────────

    private apiUrl(path: string): string {
        const timestamp = Math.floor(Date.now() / 1000)
        const sign = this.signWithToken(path, timestamp)
        return `${SHOPEE_HOST}${path}?partner_id=${this.credentials.apiKey}&timestamp=${timestamp}&sign=${sign}&shop_id=${this.credentials.shopId}&access_token=${this.credentials.accessToken}`
    }

    async fetchOrders(params: { since?: Date; page?: number; pageSize?: number }) {
        const path = '/api/v2/order/get_order_list'
        const now = Math.floor(Date.now() / 1000)
        const timeFrom = params.since ? Math.floor(params.since.getTime() / 1000) : now - 7 * 86400
        const cursor = ((params.page || 1) - 1) * (params.pageSize || 50)

        const url = this.apiUrl(path) +
            `&time_range_field=create_time&time_from=${timeFrom}&time_to=${now}` +
            `&page_size=${params.pageSize || 50}&cursor=${cursor}&response_optional_fields=order_status`

        const data = await this.httpGet(url)

        if (data.error) throw new Error(`Shopee getOrders: ${data.error} - ${data.message}`)

        const orderList = data.response?.order_list || []
        const orders: PlatformOrder[] = []

        // Fetch details for each order in batch
        if (orderList.length > 0) {
            const orderIds = orderList.map((o: any) => o.order_sn).join(',')
            const detailPath = '/api/v2/order/get_order_detail'
            const detailUrl = this.apiUrl(detailPath) +
                `&order_sn_list=${orderIds}` +
                `&response_optional_fields=buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,item_list,pay_time,ship_by_date,total_amount,order_chargeable_weight,tracking_no,shipping_carrier`

            const detailData = await this.httpGet(detailUrl)
            const details = detailData.response?.order_list || []

            for (const d of details) {
                orders.push(this.mapOrder(d))
            }
        }

        return {
            orders,
            hasMore: data.response?.more || false,
            total: orders.length,
        }
    }

    async getOrderDetail(externalOrderId: string): Promise<PlatformOrder | null> {
        const path = '/api/v2/order/get_order_detail'
        const url = this.apiUrl(path) +
            `&order_sn_list=${externalOrderId}` +
            `&response_optional_fields=buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,item_list,pay_time,total_amount,tracking_no,shipping_carrier`

        const data = await this.httpGet(url)
        const detail = data.response?.order_list?.[0]
        return detail ? this.mapOrder(detail) : null
    }

    async testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }> {
        try {
            const path = '/api/v2/shop/get_shop_info'
            const url = this.apiUrl(path)
            const data = await this.httpGet(url)

            if (data.error) return { success: false, error: `${data.error}: ${data.message}` }
            return { success: true, shopName: data.response?.shop_name || data.response?.shop_id }
        } catch (err: any) {
            return { success: false, error: err.message }
        }
    }

    // ─── Mappers ─────────────────────────────────────────────────────────────────

    private mapOrder(d: any): PlatformOrder {
        const addr = d.recipient_address || {}
        const items: PlatformOrderItem[] = (d.item_list || []).map((item: any) => ({
            externalItemId: String(item.item_id),
            productName: item.item_name,
            sku: item.item_sku,
            quantity: item.model_quantity_purchased || 1,
            unitPrice: item.model_discounted_price || item.model_original_price || 0,
            discount: (item.model_original_price || 0) - (item.model_discounted_price || item.model_original_price || 0),
            lineTotal: (item.model_discounted_price || item.model_original_price || 0) * (item.model_quantity_purchased || 1),
        }))

        return {
            externalOrderId: d.order_sn,
            orderNumber: `SPE-${d.order_sn}`,
            platform: 'shopee',
            status: this.mapStatus(d.order_status),
            externalStatus: d.order_status,
            customerName: addr.name || d.buyer_username || 'Khách Shopee',
            customerPhone: addr.phone || '',
            shippingAddress: [addr.full_address, addr.district, addr.city, addr.state].filter(Boolean).join(', '),
            subtotal: items.reduce((s: number, i: PlatformOrderItem) => s + i.lineTotal, 0),
            discount: d.voucher_absorbed_by_seller || 0,
            shippingFee: d.actual_shipping_fee ?? d.estimated_shipping_fee ?? 0,
            total: d.total_amount || 0,
            paymentMethod: d.payment_method || 'Shopee',
            paymentStatus: this.mapPaymentStatus(d.order_status),
            trackingNumber: d.tracking_no || undefined,
            shippingCarrier: d.shipping_carrier || undefined,
            items,
            createdAt: new Date((d.create_time || 0) * 1000).toISOString(),
            paidAt: d.pay_time ? new Date(d.pay_time * 1000).toISOString() : undefined,
            shippedAt: d.ship_by_date ? new Date(d.ship_by_date * 1000).toISOString() : undefined,
        }
    }

    // Get tracking number via logistics API (more reliable than order detail)
    async getTrackingNumber(orderSn: string): Promise<string | null> {
        try {
            const path = '/api/v2/logistics/get_tracking_number'
            const url = this.apiUrl(path) + `&order_sn=${orderSn}`
            const data = await this.httpGet(url)
            if (data.error) return null
            return data.response?.tracking_number || data.response?.first_mile_tracking_number || null
        } catch {
            return null
        }
    }

    // Get shipping info (logistics channel + tracking)
    async getShippingInfo(orderSn: string): Promise<{ trackingNumber: string | null; carrier: string | null }> {
        try {
            const path = '/api/v2/logistics/get_shipping_parameter'
            const url = this.apiUrl(path) + `&order_sn=${orderSn}`
            const data = await this.httpGet(url)
            const info = data.response?.info_needed || {}
            return {
                trackingNumber: await this.getTrackingNumber(orderSn),
                carrier: info.pickup?.address_list?.[0]?.logistics_channel_name || null,
            }
        } catch {
            return { trackingNumber: await this.getTrackingNumber(orderSn), carrier: null }
        }
    }

    protected mapStatus(s: string): string {
        const MAP: Record<string, string> = {
            UNPAID: 'pending',
            READY_TO_SHIP: 'confirmed',
            PROCESSED: 'processing',
            RETRY_SHIP: 'processing',
            SHIPPED: 'shipping',
            TO_CONFIRM_RECEIVE: 'delivered',
            COMPLETED: 'completed',
            IN_CANCEL: 'cancelled',
            CANCELLED: 'cancelled',
            INVOICE_PENDING: 'pending',
            TO_RETURN: 'cancelled',
        }
        return MAP[s] || 'pending'
    }

    protected mapPaymentStatus(s: string): string {
        if (s === 'UNPAID' || s === 'INVOICE_PENDING') return 'unpaid'
        if (s === 'CANCELLED' || s === 'IN_CANCEL') return 'refunded'
        return 'paid'
    }

    // ─── Shipping Document (AWB) ─────────────────────────────────────────────────

    /**
     * Full flow: get params → get package_number → try each doc type → create → wait → download
     * IMPORTANT: shipping_document_type is a TOP-LEVEL param, NOT inside order_list
     */
    async downloadShippingLabel(orderSn: string): Promise<{ pdf: Buffer; contentType: string }> {
        // Step 1: Get shipping document parameters
        const paramUrl = this.apiUrl('/api/v2/logistics/get_shipping_document_parameter')
        const paramData = await this.httpPost(paramUrl, { order_list: [{ order_sn: orderSn }] })
        console.log(`[Shopee AWB] get_param for ${orderSn}:`, JSON.stringify(paramData).substring(0, 500))
        if (paramData.error) throw new Error(`get_param: ${paramData.error} - ${paramData.message}`)

        const paramResult = paramData.response?.result_list?.[0]
        if (paramResult?.fail_error) {
            throw new Error(`Đơn ${orderSn}: ${paramResult.fail_error} - ${paramResult.fail_message}`)
        }

        // Step 2: Get order detail with package_list to find package_number
        const detailUrl = this.apiUrl('/api/v2/order/get_order_detail') + `&order_sn_list=${orderSn}&response_optional_fields=package_list`
        const detailData = await this.httpGet(detailUrl)
        const orderDetail = detailData?.response?.order_list?.[0]
        const packageList = orderDetail?.package_list || []
        const packageNumber = packageList[0]?.package_number || undefined
        console.log(`[Shopee AWB] package_number for ${orderSn}: ${packageNumber || 'none'}`)

        // Build the order_list item (NO shipping_document_type here!)
        const orderItem: any = { order_sn: orderSn }
        if (packageNumber) orderItem.package_number = packageNumber

        // Get selectable document types
        const selectableTypes: string[] = paramResult?.selectable_shipping_document_type || []
        const suggestedType = paramResult?.suggest_shipping_document_type || 'NORMAL_AIR_WAYBILL'
        const docTypes = [suggestedType, ...selectableTypes.filter((t: string) => t !== suggestedType)]
        console.log(`[Shopee AWB] will try doc types for ${orderSn}:`, docTypes)

        // Try each document type
        for (const docType of docTypes) {
            console.log(`[Shopee AWB] trying ${docType} for ${orderSn}...`)

            // Try CREATE: shipping_document_type is TOP-LEVEL per Shopee docs
            const createUrl = this.apiUrl('/api/v2/logistics/create_shipping_document')
            const createBody = { shipping_document_type: docType, order_list: [{ order_sn: orderSn }] }
            const createData = await this.httpPost(createUrl, createBody)
            console.log(`[Shopee AWB] create ${docType}:`, JSON.stringify(createData).substring(0, 300))

            if (!createData.error) {
                // Poll for ready
                for (let i = 0; i < 15; i++) {
                    await this.sleep(1000)
                    const resultUrl = this.apiUrl('/api/v2/logistics/get_shipping_document_result')
                    const resultBody = { shipping_document_type: docType, order_list: [{ order_sn: orderSn }] }
                    const resultData = await this.httpPost(resultUrl, resultBody)
                    const r = resultData.response?.result_list?.[0]
                    console.log(`[Shopee AWB] poll ${i}: status=${r?.status}`)
                    if (r?.status === 'READY') break
                    if (r?.status === 'FAILED') break
                }
            } else {
                console.log(`[Shopee AWB] create ${docType} failed: ${createData.error}`)
            }

            // Try DOWNLOAD: shipping_document_type is TOP-LEVEL
            const downloadUrl = this.apiUrl('/api/v2/logistics/download_shipping_document')
            const downloadBody = { shipping_document_type: docType, order_list: [orderItem] }
            const res = await fetch(downloadUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(downloadBody),
            })

            const contentType = res.headers.get('content-type') || 'application/pdf'
            if (!contentType.includes('application/json')) {
                // SUCCESS - got PDF binary
                console.log(`[Shopee AWB] SUCCESS with ${docType} for ${orderSn}`)
                const arrayBuf = await res.arrayBuffer()
                return { pdf: Buffer.from(arrayBuf), contentType }
            }

            // JSON = error, log and try next type
            const errData: any = await res.json()
            console.log(`[Shopee AWB] download ${docType} failed:`, JSON.stringify(errData).substring(0, 300))
        }

        // All types failed
        throw new Error(`Đơn ${orderSn}: Không thể tải vận đơn. Đã thử ${docTypes.join(', ')}. Vui lòng in trên Shopee Seller Center.`)
    }

    /**
     * Batch download: create + download multiple orders in ONE PDF
     * Tries all doc types like the single-order method
     */
    async downloadShippingLabelBatch(orderSnList: string[]): Promise<{ pdf: Buffer; contentType: string; errors: string[] }> {
        const errors: string[] = []

        // Step 1: Get shipping doc params for all orders
        const paramUrl = this.apiUrl('/api/v2/logistics/get_shipping_document_parameter')
        const paramData = await this.httpPost(paramUrl, { order_list: orderSnList.map(sn => ({ order_sn: sn })) })
        console.log(`[Shopee AWB Batch] get_param for ${orderSnList.length} orders`)
        if (paramData.error) throw new Error(`get_param: ${paramData.error} - ${paramData.message}`)

        // Get all selectable doc types
        const results = paramData.response?.result_list || []
        const selectableTypes: string[] = []
        let suggestedType = 'NORMAL_AIR_WAYBILL'
        for (const r of results) {
            if (r.suggest_shipping_document_type) suggestedType = r.suggest_shipping_document_type
            for (const t of (r.selectable_shipping_document_type || [])) {
                if (!selectableTypes.includes(t)) selectableTypes.push(t)
            }
        }
        const docTypes = [suggestedType, ...selectableTypes.filter(t => t !== suggestedType)]
        console.log(`[Shopee AWB Batch] doc types to try:`, docTypes)

        // Step 2: Get package_numbers for all orders
        const snListStr = orderSnList.join(',')
        const detailUrl = this.apiUrl('/api/v2/order/get_order_detail') + `&order_sn_list=${snListStr}&response_optional_fields=package_list`
        const detailData = await this.httpGet(detailUrl)
        const orderDetails = detailData?.response?.order_list || []

        // Build order_list items with package_numbers
        const orderListItems = orderSnList.map((sn: string) => {
            const detail = orderDetails.find((d: any) => d.order_sn === sn)
            const pkgNum = detail?.package_list?.[0]?.package_number
            const item: any = { order_sn: sn }
            if (pkgNum) item.package_number = pkgNum
            return item
        })

        // Step 3: Try each doc type (just like single-order method)
        for (const docType of docTypes) {
            console.log(`[Shopee AWB Batch] trying ${docType}...`)

            // Try CREATE (may fail — that's OK, document might already exist)
            const createUrl = this.apiUrl('/api/v2/logistics/create_shipping_document')
            const createBody = { shipping_document_type: docType, order_list: orderSnList.map(sn => ({ order_sn: sn })) }
            const createData = await this.httpPost(createUrl, createBody)
            console.log(`[Shopee AWB Batch] create ${docType}:`, JSON.stringify(createData).substring(0, 500))

            if (!createData.error) {
                // Poll for ready
                for (let i = 0; i < 20; i++) {
                    await this.sleep(1000)
                    const resultUrl = this.apiUrl('/api/v2/logistics/get_shipping_document_result')
                    const resultBody = { shipping_document_type: docType, order_list: orderSnList.map(sn => ({ order_sn: sn })) }
                    const resultData = await this.httpPost(resultUrl, resultBody)
                    const rl = resultData.response?.result_list || []
                    const allReady = rl.every((r: any) => r.status === 'READY' || r.status === 'FAILED')
                    if (allReady) break
                }
            }

            // Try DOWNLOAD regardless of create result
            const downloadUrl = this.apiUrl('/api/v2/logistics/download_shipping_document')
            const downloadBody = { shipping_document_type: docType, order_list: orderListItems }
            const res = await fetch(downloadUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(downloadBody),
            })

            const contentType = res.headers.get('content-type') || 'application/pdf'
            if (!contentType.includes('application/json')) {
                console.log(`[Shopee AWB Batch] SUCCESS with ${docType}! ${orderSnList.length} orders in 1 PDF`)
                const arrayBuf = await res.arrayBuffer()
                return { pdf: Buffer.from(arrayBuf), contentType, errors }
            }

            // JSON = error, try next type
            const errData: any = await res.json()
            console.log(`[Shopee AWB Batch] download ${docType} failed:`, JSON.stringify(errData).substring(0, 300))
        }

        throw new Error(`Batch: Không thể tải vận đơn. Đã thử ${docTypes.join(', ')}`)
    }

    // ── Returns / Refunds from Shopee ────────────────────────────────────
    async fetchReturns(params: { since?: Date }) {
        const path = '/api/v2/returns/get_return_list'
        const now = Math.floor(Date.now() / 1000)
        const timeFrom = params.since ? Math.floor(params.since.getTime() / 1000) : now - 15 * 86400

        const url = this.apiUrl(path) +
            `&create_time_from=${timeFrom}&create_time_to=${now}` +
            `&page_no=1&page_size=50`

        const data = await this.httpGet(url)
        if (data.error) throw new Error(`Shopee getReturns: ${data.error} - ${data.message}`)

        const returnList = data.response?.return || []
        return returnList.map((r: any) => this.mapReturn(r))
    }

    async getReturnDetail(returnSn: string) {
        const path = '/api/v2/returns/get_return_detail'
        const url = this.apiUrl(path) + `&return_sn=${returnSn}`
        const data = await this.httpGet(url)
        if (data.error) throw new Error(`Shopee getReturnDetail: ${data.error} - ${data.message}`)
        return this.mapReturn(data.response)
    }

    private mapReturn(r: any) {
        const RETURN_STATUS_MAP: Record<string, string> = {
            REQUESTED: 'pending',
            ACCEPTED: 'approved',
            CANCELLED: 'rejected',
            JUDGING: 'pending',
            REFUND_PAID: 'refunded',
            CLOSED: 'rejected',
            PROCESSING: 'pending',
            SELLER_DISPUTE: 'pending',
        }

        return {
            returnSn: String(r.return_sn || r.returnsn || ''),
            orderSn: r.order_sn || '',
            status: RETURN_STATUS_MAP[r.status] || 'pending',
            shopeeStatus: r.status || '',
            reason: r.reason || r.return_reason || '',
            textReason: r.text_reason || '',
            refundAmount: (r.refund_amount || 0),
            currency: r.currency || 'VND',
            trackingNumber: r.tracking_number || '',
            images: r.images || [],
            items: (r.item || []).map((i: any) => ({
                itemId: String(i.item_id || ''),
                name: i.name || '',
                modelName: i.model_name || '',
                amount: i.amount || 0,
                itemPrice: i.item_price || 0,
            })),
            createTime: r.create_time ? new Date(r.create_time * 1000) : new Date(),
            updateTime: r.update_time ? new Date(r.update_time * 1000) : new Date(),
            needReturn: r.need_return ?? false,  // buyer needs to ship back?
            disputeReason: r.seller_dispute_reason || '',
        }
    }

    private sleep(ms: number) {
        return new Promise(r => setTimeout(r, ms))
    }
}
