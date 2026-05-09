import { PlatformService, PlatformCredentials, PlatformOrder, PlatformOrderItem, PlatformProduct, TokenResponse } from './base'

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
        const partnerId = parseInt(this.credentials.apiKey, 10)
        if (isNaN(partnerId) || partnerId <= 0) {
            throw new Error(`Partner ID không hợp lệ: "${this.credentials.apiKey}". Partner ID phải là số nguyên (ví dụ: 2007533). Vui lòng kiểm tra lại trên Shopee Partner Center.`)
        }
        const params = new URLSearchParams({
            partner_id: String(partnerId),
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

        const partnerId = parseInt(this.credentials.apiKey, 10)
        const url = `${SHOPEE_API}/auth/token/get?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`
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

        const partnerId = parseInt(this.credentials.apiKey, 10)
        const url = `${SHOPEE_API}/auth/access_token/get?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`
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
        const partnerId = parseInt(this.credentials.apiKey, 10) || this.credentials.apiKey
        return `${SHOPEE_HOST}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&shop_id=${this.credentials.shopId}&access_token=${this.credentials.accessToken}`
    }

    async fetchOrders(params: { since?: Date; page?: number; pageSize?: number }) {
        const path = '/api/v2/order/get_order_list'
        const now = Math.floor(Date.now() / 1000)
        const timeFrom = params.since ? Math.floor(params.since.getTime() / 1000) : now - 14 * 86400
        const cursor = ((params.page || 1) - 1) * (params.pageSize || 50)

        const url = this.apiUrl(path) +
            `&time_range_field=update_time&time_from=${timeFrom}&time_to=${now}` +
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

    // ── Products ─────────────────────────────────────────────────────────────────

    async fetchProducts(): Promise<{ products: PlatformProduct[]; total: number }> {
        const allProducts: PlatformProduct[] = []
        let offset = 0
        const pageSize = 50
        let hasMore = true

        while (hasMore && offset < 5000) { // Safety: max 5000 products
            // Step 1: Get item IDs
            const listPath = '/api/v2/product/get_item_list'
            const listUrl = this.apiUrl(listPath) +
                `&offset=${offset}&page_size=${pageSize}&item_status=NORMAL`

            const listData = await this.httpGet(listUrl)
            if (listData.error) {
                console.error(`[Shopee Products] get_item_list error:`, listData.error, listData.message)
                break
            }

            const itemList = listData.response?.item || []
            if (itemList.length === 0) break

            // Step 2: Get item details in batch (max 50 per call)
            const itemIds = itemList.map((i: any) => i.item_id)
            const detailPath = '/api/v2/product/get_item_base_info'
            const detailUrl = this.apiUrl(detailPath) +
                `&item_id_list=${itemIds.join(',')}`

            const detailData = await this.httpGet(detailUrl)
            if (detailData.error) {
                console.error(`[Shopee Products] get_item_base_info error:`, detailData.error, detailData.message)
                break
            }

            const details = detailData.response?.item_list || []
            for (const d of details) {
                // Get best price: model price > item price
                let price = 0
                if (d.price_info) {
                    price = d.price_info[0]?.current_price || d.price_info[0]?.original_price || 0
                }
                // Get total stock from all models
                let stock = 0
                if (d.stock_info_v2) {
                    stock = d.stock_info_v2.current_stock || d.stock_info_v2.normal_stock || 0
                }

                const imageUrl = d.image?.image_url_list?.[0] || ''
                const sku = d.item_sku || ''

                allProducts.push({
                    platformProductId: String(d.item_id),
                    name: d.item_name || 'Unnamed',
                    sku: sku || undefined,
                    price,
                    stock,
                    status: d.item_status || 'NORMAL',
                    imageUrl,
                })
            }

            hasMore = listData.response?.has_next_page || false
            offset += pageSize
            console.log(`[Shopee Products] Fetched ${allProducts.length} products (offset=${offset}, hasMore=${hasMore})`)
        }

        console.log(`[Shopee Products] Total: ${allProducts.length} products synced`)
        return { products: allProducts, total: allProducts.length }
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
            discount: 0,
            shippingFee: d.actual_shipping_fee ?? d.estimated_shipping_fee ?? 0,
            total: items.reduce((s: number, i: PlatformOrderItem) => s + i.lineTotal, 0),
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
        // Giữ nguyên UPPERCASE Shopee status để đồng nhất với frontend tab filter
        // Full Shopee status flow:
        //   UNPAID → READY_TO_SHIP → PROCESSED → SHIPPED → TO_CONFIRM_RECEIVE → COMPLETED
        //   Side branches: RETRY_SHIP, IN_CANCEL, CANCELLED, TO_RETURN
        const KNOWN: Record<string, string> = {
            UNPAID:             'UNPAID',
            INVOICE_PENDING:    'UNPAID',        // Alias — map vào UNPAID tab
            READY_TO_SHIP:      'READY_TO_SHIP',
            PROCESSED:          'PROCESSED',
            SHIPPED:            'SHIPPED',
            RETRY_SHIP:         'SHIPPED',       // Giao lại → vẫn là SHIPPED tab
            TO_CONFIRM_RECEIVE: 'TO_CONFIRM_RECEIVE',
            COMPLETED:          'COMPLETED',
            IN_CANCEL:          'IN_CANCEL',
            CANCELLED:          'CANCELLED',
            TO_RETURN:          'TO_RETURN',
        }
        return KNOWN[s] || s || 'UNPAID'
    }

    protected mapPaymentStatus(s: string): string {
        if (s === 'UNPAID' || s === 'INVOICE_PENDING') return 'unpaid'
        if (s === 'IN_CANCEL') return 'unpaid'          // Chưa hoàn tiền, đang xét
        if (s === 'CANCELLED' || s === 'TO_RETURN') return 'refunded'
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
     * Batch: download từng đơn riêng → pdf-lib merge → 1 PDF
     * Không dùng Shopee batch API (unreliable — trả 1 label khi 1 đơn fail)
     */
    async downloadShippingLabelBatch(orderSnList: string[]): Promise<{ pdf: Buffer; contentType: string; errors: string[] }> {
        const { PDFDocument } = await import('pdf-lib')
        const errors: string[] = []
        const pdfBuffers: Buffer[] = []

        console.log(`[AWB Batch] Downloading ${orderSnList.length} labels individually: ${orderSnList.join(', ')}`)

        for (const sn of orderSnList) {
            try {
                const { pdf } = await this.downloadShippingLabel(sn)
                pdfBuffers.push(pdf)
                console.log(`[AWB Batch] ✅ ${sn}: ${pdf.byteLength}b`)
            } catch (e: any) {
                console.error(`[AWB Batch] ❌ ${sn}:`, e.message)
                errors.push(`${sn}: ${e.message}`)
            }
            // Small delay to avoid Shopee API rate limit
            if (orderSnList.indexOf(sn) < orderSnList.length - 1) await this.sleep(1000)
        }

        if (pdfBuffers.length === 0) throw new Error(`Không tải được vận đơn. ${errors.join('; ')}`)
        if (pdfBuffers.length === 1) return { pdf: pdfBuffers[0], contentType: 'application/pdf', errors }

        // Merge all PDFs into 1 (ignoreEncryption for Shopee protected PDFs)
        console.log(`[AWB Batch] Merging ${pdfBuffers.length} PDFs...`)
        const merged = await PDFDocument.create()
        for (const buf of pdfBuffers) {
            try {
                const src = await PDFDocument.load(buf, { ignoreEncryption: true })
                const pages = await merged.copyPages(src, src.getPageIndices())
                pages.forEach(p => merged.addPage(p))
            } catch (e: any) {
                console.error('[AWB Batch] merge error:', e.message)
                errors.push(`merge: ${e.message}`)
            }
        }
        const out = await merged.save()
        console.log(`[AWB Batch] ✅ Merged: ${out.byteLength}b, ${merged.getPageCount()} pages`)
        return { pdf: Buffer.from(out), contentType: 'application/pdf', errors }
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

    // ── Seller Chat API ─────────────────────────────────────────────────────
    // Docs: https://open.shopee.com/documents/v2/v2.sellerchat

    /**
     * Get list of conversations from Shopee seller chat
     * Uses GET /api/v2/sellerchat/get_conversation_list
     */
    async getConversationList(params: {
        direction?: string   // 'latest' (default) or 'older'
        type?: string        // 'all', 'pinned', 'unread'
        pageSize?: number
    } = {}): Promise<{
        conversations: Array<{
            conversationId: string
            toId: number
            toName: string
            toAvatar: string
            lastMessage: string
            lastMessageType: string
            lastSenderId: number
            unreadCount: number
            pinned: boolean
            lastMessageTimestamp: number
            lastReadMessageId: string
        }>
        hasMore: boolean
        nextOffset: string
    }> {
        const path = '/api/v2/sellerchat/get_conversation_list'
        const pageSize = params.pageSize || 100 // Get max per page

        // Auto-paginate to collect ALL conversations
        let allConvs: any[] = []
        let nextOffset: string | undefined = undefined
        let pageCount = 0
        const maxPages = 10 // Safety limit

        do {
            let url = this.apiUrl(path) +
                `&type=${params.type || 'all'}` +
                `&page_size=${pageSize}`
            if (nextOffset) url += `&offset=${nextOffset}&direction=older`

            const data = await this.httpGet(url)
            console.log(`[Shopee Chat] get_conversation_list page ${pageCount + 1}:`, JSON.stringify(data).substring(0, 500))

            if (data.error && data.error !== '') throw new Error(`Shopee getConversationList: ${data.error} - ${data.message}`)

            const resp = data.response || data
            const convList = resp.conversation_list || resp.conversations || resp.page_result?.conversations ||
                (Array.isArray(resp) ? resp : [])

            if (convList.length > 0) {
                if (pageCount === 0 && convList[0]) console.log('[Shopee Chat] FIRST ITEM RAW:', JSON.stringify(convList[0]))
                allConvs = allConvs.concat(convList)
            }

            nextOffset = resp.page_result?.next_offset || resp.next_offset
            const hasMore = resp.page_result?.more || resp.more || false
            pageCount++

            if (!hasMore || !nextOffset || pageCount >= maxPages) break
        } while (true)

        console.log(`[Shopee Chat] Total conversations collected: ${allConvs.length} from ${pageCount} pages`)

        // Sort conversations by last message timestamp (descending)
        allConvs.sort((a, b) => (b.last_message_timestamp || 0) - (a.last_message_timestamp || 0))

        return {
            conversations: allConvs.map((c: any) => ({
                conversationId: String(c.conversation_id || ''),
                toId: c.to_id || 0,
                toName: c.to_name || '',
                toAvatar: c.to_avatar || '',
                lastMessage: c.latest_message_content?.text || c.latest_message_content?.url || '',
                lastMessageType: c.latest_message_type || 'text',
                lastSenderId: c.last_message_from_id || 0,
                unreadCount: c.unread_count || 0,
                pinned: c.pinned || false,
                lastMessageTimestamp: c.last_message_timestamp || 0,
                lastReadMessageId: String(c.last_read_message_id || ''),
            })),
            hasMore: false, // We already collected all pages
            nextOffset: '',
        }
    }

    /**
     * Get messages for a specific conversation
     * Uses GET /api/v2/sellerchat/get_message
     */
    async getMessages(conversationId: string, params: {
        pageSize?: number
        offset?: string
    } = {}): Promise<{
        messages: Array<{
            messageId: string
            messageType: string
            content: string
            imageUrl?: string
            fromId: number
            fromName: string
            toId: number
            toName: string
            createdTimestamp: number
            sourceContent?: any
        }>
        hasMore: boolean
        nextOffset: string
    }> {
        const path = '/api/v2/sellerchat/get_message'
        let url = this.apiUrl(path) +
            `&conversation_id=${conversationId}` +
            `&page_size=${params.pageSize || 25}`
        if (params.offset) url += `&offset=${params.offset}`

        const data = await this.httpGet(url)
        console.log('[Shopee Chat] get_message FULL response:', JSON.stringify(data).substring(0, 2000))
        if (data.response) console.log('[Shopee Chat] message response.keys:', JSON.stringify(Object.keys(data.response || {})))

        if (data.error && data.error !== '') throw new Error(`Shopee getMessages: ${data.error} - ${data.message}`)

        const resp = data.response || data
        const msgList = resp.message_list || resp.messages || (Array.isArray(resp) ? resp : [])
        return {
            messages: msgList.map((m: any) => {
                let content = ''
                let imageUrl: string | undefined

                if (m.message_type === 'text') {
                    content = m.content?.text || ''
                } else if (m.message_type === 'image') {
                    content = '[Hình ảnh]'
                    imageUrl = m.content?.image_url || m.content?.url || ''
                } else if (m.message_type === 'sticker') {
                    content = '[Sticker]'
                    imageUrl = m.content?.sticker_url || m.content?.url || ''
                } else if (m.message_type === 'order') {
                    content = `[Đơn hàng #${m.content?.order_sn || ''}]`
                } else if (m.message_type === 'item') {
                    content = `[Sản phẩm: ${m.content?.item_name || ''}]`
                } else {
                    content = m.content?.text || m.content?.url || `[${m.message_type}]`
                }

                return {
                    messageId: String(m.message_id || ''),
                    messageType: m.message_type || 'text',
                    content,
                    imageUrl,
                    fromId: m.from_id || 0,
                    fromName: m.from_user_name || '',
                    toId: m.to_id || 0,
                    toName: m.to_user_name || '',
                    createdTimestamp: m.created_timestamp || 0,
                    sourceContent: m.content,
                }
            }),
            hasMore: data.response?.page_result?.has_more || false,
            nextOffset: String(data.response?.page_result?.next_offset || ''),
        }
    }

    /**
     * Send a text message to a buyer
     * Uses POST /api/v2/sellerchat/send_message
     */
    async sendMessage(toId: number, content: string): Promise<{
        messageId: string
        conversationId: string
    }> {
        const path = '/api/v2/sellerchat/send_message'
        const url = this.apiUrl(path)

        const body = {
            to_id: toId,
            message_type: 'text',
            content: { text: content },
        }

        const data = await this.httpPost(url, body)
        console.log('[Shopee Chat] send_message response:', JSON.stringify(data).substring(0, 300))

        if (data.error) throw new Error(`Shopee sendMessage: ${data.error} - ${data.message}`)

        return {
            messageId: String(data.response?.message_id || ''),
            conversationId: String(data.response?.conversation_id || ''),
        }
    }

    /**
     * Read/unread messages (mark as read)
     * Uses POST /api/v2/sellerchat/read_conversation
     */
    async readConversation(conversationId: string, lastReadMessageId: string): Promise<void> {
        const path = '/api/v2/sellerchat/read_conversation'
        const url = this.apiUrl(path)
        const body = {
            conversation_id: conversationId,
            last_read_message_id: lastReadMessageId,
        }
        await this.httpPost(url, body)
    }

    private sleep(ms: number) {
        return new Promise(r => setTimeout(r, ms))
    }
}
