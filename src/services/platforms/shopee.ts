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

    // ─── Egress qua proxy Tino (IP tĩnh đã whitelist) ─────────────────────────────
    // Cloud Run có IP egress ĐỘNG → Shopee chặn source_ip_undeclared. Nếu có
    // SHOPEE_FORWARD_PROXY thì mọi call Shopee đi qua proxy chuyển tiếp câm trên
    // Tino (backend VẪN tự ký, proxy chỉ forward). Chưa cấu hình → gọi thẳng như
    // cũ (fallback an toàn, không đổi hành vi). Chỉ override cho Shopee, các sàn
    // khác (TikTok/Lazada) dùng httpGet/httpPost gốc ở base.
    private async shopeeFetch(url: string, method: 'GET' | 'POST', body?: any): Promise<Response> {
        const proxy = process.env.SHOPEE_FORWARD_PROXY
        if (!proxy) {
            return fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
            })
        }
        return fetch(proxy, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: process.env.SHOPEE_FORWARD_SECRET || '',
                url,
                method,
                body: method === 'POST' ? (body ?? {}) : undefined,
            }),
        })
    }

    protected async httpGet(url: string): Promise<any> {
        return this.parseResponse(await this.shopeeFetch(url, 'GET'))
    }

    protected async httpPost(url: string, body: any): Promise<any> {
        return this.parseResponse(await this.shopeeFetch(url, 'POST', body))
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

    async fetchOrders(params: { since?: Date; until?: Date; page?: number; pageSize?: number; status?: string; pageToken?: string; timeRangeField?: 'update_time' | 'create_time' }) {
        const path = '/api/v2/order/get_order_list'
        const now = Math.floor(Date.now() / 1000)
        const timeFrom = params.since ? Math.floor(params.since.getTime() / 1000) : now - 14 * 86400
        // Shopee rejects windows > 15 days — clamp time_to so a stray wide window degrades instead of erroring
        const timeTo = Math.min(params.until ? Math.floor(params.until.getTime() / 1000) : now, timeFrom + 15 * 86400 - 1)

        // Shopee v2 dùng cursor OPAQUE trả về trong response.next_cursor — phải
        // truyền lại nguyên văn (không tự chế offset số, sẽ sót/trùng đơn).
        const cursor = params.pageToken || ''

        // update_time cho sync gia số; create_time cho kéo lịch sử theo ngày đặt
        const rangeField = params.timeRangeField || 'update_time'

        let url = this.apiUrl(path) +
            `&time_range_field=${rangeField}&time_from=${timeFrom}&time_to=${timeTo}` +
            `&page_size=${params.pageSize || 50}&cursor=${encodeURIComponent(cursor)}&response_optional_fields=order_status`
        if (params.status) url += `&order_status=${encodeURIComponent(params.status)}`

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
            hasMore: (data.response?.more || false) && !!data.response?.next_cursor,
            total: orders.length,
            nextPageToken: data.response?.next_cursor || undefined,
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
                    // get_item_base_info trả sẵn category_id — lưu để map hoa hồng theo ngành
                    categoryId: d.category_id ? String(d.category_id) : undefined,
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
            // SP có PHÂN LOẠI: item_sku (cấp SP) thường RỖNG — mã thật nằm ở
            // model_sku (cấp phân loại). Kèm model_name vào tên để phiếu đóng gói
            // biết lấy đúng loại (10W vs 20W...), không gộp mù các phân loại.
            productName: item.item_name + (item.model_name ? ` [${item.model_name}]` : ''),
            sku: item.model_sku || item.item_sku,
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

    /** Lỗi thuộc về KÊNH (token/quyền/IP) chứ không phải về một đơn cụ thể —
     *  thử tiếp các đơn còn lại chỉ tổ đốt hạn mức, kết quả vẫn hỏng y hệt. */
    static isChannelAuthError(err: string): boolean {
        return /error_auth|invalid_access_token|access_token|error_permission|source_ip_undeclared/i.test(err)
    }

    // Get tracking number via logistics API.
    // ĐÂY LÀ NGUỒN DUY NHẤT: get_order_detail của Shopee không trả tracking_no
    // (trả shipping_carrier nên nhìn qua tưởng có đủ). Trước đây hàm nuốt sạch lỗi
    // thành null → kênh hỏng token/IP báo "đơn không có mã" cho cả nghìn đơn mà
    // sync vẫn ✅. Giờ: lỗi cấp kênh thì NÉM để người gọi dừng sớm và báo đúng
    // bệnh; lỗi lẻ thì log rồi trả null; null "sạch" = sàn thật sự chưa cấp mã.
    async getTrackingNumber(orderSn: string): Promise<string | null> {
        const url = this.apiUrl('/api/v2/logistics/get_tracking_number') + `&order_sn=${orderSn}`
        let data: any
        try {
            data = await this.httpGet(url)
        } catch (e: any) {
            const msg = String(e?.message || e)
            if (ShopeeService.isChannelAuthError(msg)) throw e
            console.warn(`[Shopee tracking] ${orderSn}: gọi API lỗi — ${msg}`)
            return null
        }
        if (data?.error) {
            const err = String(data.error)
            const detail = data.message ? ` - ${data.message}` : ''
            if (ShopeeService.isChannelAuthError(err)) {
                throw new Error(`Shopee từ chối kênh: ${err}${detail}`)
            }
            // vd. đơn chưa tới bước được cấp mã → không phải lỗi, chỉ là chưa có
            console.warn(`[Shopee tracking] ${orderSn}: ${err}${detail}`)
            return null
        }
        return data.response?.tracking_number || data.response?.first_mile_tracking_number || null
    }

    // Get shipping info (logistics channel + tracking)
    // Lấy mã MỘT lần ở ngoài: trước đây nó nằm trong try nên khi hỏng, nhánh catch
    // gọi lại lần nữa — tốn 2 call cho cùng một đơn.
    async getShippingInfo(orderSn: string): Promise<{ trackingNumber: string | null; carrier: string | null }> {
        const trackingNumber = await this.getTrackingNumber(orderSn)
        try {
            const path = '/api/v2/logistics/get_shipping_parameter'
            const url = this.apiUrl(path) + `&order_sn=${orderSn}`
            const data = await this.httpGet(url)
            const info = data.response?.info_needed || {}
            return {
                trackingNumber,
                carrier: info.pickup?.address_list?.[0]?.logistics_channel_name || null,
            }
        } catch {
            return { trackingNumber, carrier: null }
        }
    }

    /**
     * Arrange shipment (RTS) for a READY_TO_SHIP order.
     * Flow: get_shipping_parameter → build pickup/dropoff body from what Shopee
     * says it needs → POST /api/v2/logistics/ship_order.
     */
    async shipOrder(orderSn: string): Promise<void> {
        const paramUrl = this.apiUrl('/api/v2/logistics/get_shipping_parameter') + `&order_sn=${orderSn}`
        const paramData = await this.httpGet(paramUrl)
        if (paramData.error) throw new Error(`Shopee get_shipping_parameter: ${paramData.error} - ${paramData.message}`)

        const resp = paramData.response || {}
        const infoNeeded = resp.info_needed || {}
        const body: any = { order_sn: orderSn }

        if (Array.isArray(infoNeeded.pickup)) {
            // Seller pickup: Shopee returns the usable warehouse addresses + time slots
            const addresses = resp.pickup?.address_list || []
            const addr = addresses.find((a: any) => (a.address_flag || []).includes('pickup_address')) || addresses[0]
            if (!addr) throw new Error(`Đơn ${orderSn}: Shopee không trả về địa chỉ lấy hàng — kiểm tra địa chỉ kho trên Seller Center`)
            const pickup: any = {}
            if (infoNeeded.pickup.includes('address_id')) pickup.address_id = addr.address_id
            if (infoNeeded.pickup.includes('pickup_time_id')) {
                const slot = (addr.time_slot_list || [])[0]
                if (!slot?.pickup_time_id) throw new Error(`Đơn ${orderSn}: không có khung giờ lấy hàng khả dụng — thử lại sau hoặc RTS trên Seller Center`)
                pickup.pickup_time_id = slot.pickup_time_id
            }
            body.pickup = pickup
        } else if (Array.isArray(infoNeeded.dropoff)) {
            const dropoff: any = {}
            const branch = (resp.dropoff?.branch_list || [])[0]
            if (infoNeeded.dropoff.includes('branch_id')) {
                if (!branch?.branch_id) throw new Error(`Đơn ${orderSn}: Shopee không trả về điểm gửi hàng (branch) — RTS trên Seller Center`)
                dropoff.branch_id = branch.branch_id
            }
            if (infoNeeded.dropoff.includes('sender_real_name')) dropoff.sender_real_name = resp.dropoff?.sender_real_name || ''
            body.dropoff = dropoff
        } else if (Array.isArray(infoNeeded.non_integrated)) {
            // Self-arranged shipping — tracking number is optional at RTS time
            body.non_integrated = {}
        } else {
            // Shopee says nothing is needed — ship with the default (pickup) method
            body.pickup = {}
        }

        console.log(`[Shopee RTS] ship_order ${orderSn}:`, JSON.stringify(body).substring(0, 300))
        const data = await this.httpPost(this.apiUrl('/api/v2/logistics/ship_order'), body)
        if (data.error) throw new Error(`Shopee ship_order: ${data.error} - ${data.message}`)
    }

    /**
     * Seller-initiated cancellation — POST /api/v2/order/cancel_order.
     * Reason OUT_OF_STOCK requires item_list; when not provided we cancel with
     * every item on the order (fetched from order detail).
     */
    async cancelOrder(orderSn: string, reason: string = 'OUT_OF_STOCK'): Promise<void> {
        const body: any = { order_sn: orderSn, cancel_reason: reason }

        if (reason === 'OUT_OF_STOCK') {
            const detailUrl = this.apiUrl('/api/v2/order/get_order_detail') +
                `&order_sn_list=${orderSn}&response_optional_fields=item_list`
            const detailData = await this.httpGet(detailUrl)
            const items = detailData?.response?.order_list?.[0]?.item_list || []
            body.item_list = items.map((i: any) => ({
                item_id: i.item_id,
                ...(i.model_id ? { model_id: i.model_id } : {}),
            }))
        }

        const data = await this.httpPost(this.apiUrl('/api/v2/order/cancel_order'), body)
        if (data.error) throw new Error(`Shopee cancel_order: ${data.error} - ${data.message}`)
    }

    /**
     * Accept or reject a buyer's cancellation request (order in IN_CANCEL).
     * POST /api/v2/order/handle_buyer_cancellation.
     */
    async handleBuyerCancellation(orderSn: string, operation: 'ACCEPT' | 'REJECT'): Promise<void> {
        const body = { order_sn: orderSn, operation }
        const data = await this.httpPost(this.apiUrl('/api/v2/order/handle_buyer_cancellation'), body)
        if (data.error) throw new Error(`Shopee handle_buyer_cancellation: ${data.error} - ${data.message}`)
    }

    /**
     * Accept a return/refund request — POST /api/v2/returns/confirm.
     * Seller agrees to the return; Shopee proceeds with the refund.
     */
    async confirmReturn(returnSn: string): Promise<void> {
        const data = await this.httpPost(this.apiUrl('/api/v2/returns/confirm'), { return_sn: returnSn })
        if (data.error) throw new Error(`Shopee returns/confirm: ${data.error} - ${data.message}`)
    }

    /**
     * Dispute (disagree with) a return request — POST /api/v2/returns/dispute.
     * Shopee requires a contact email + dispute reason; images optional.
     * dispute_reason enum (Shopee v2): 1 NON_RECEIPT, 2 OTHER, 3 NOT_RECEIVED,
     * 4 WRONG_ITEM, 5 ITEM_DAMAGED... — caller passes the applicable code.
     */
    async disputeReturn(returnSn: string, params: { email: string; reason: number; textReason: string; images?: string[] }): Promise<void> {
        const body: any = {
            return_sn: returnSn,
            email: params.email,
            dispute_reason: params.reason,
            dispute_text_reason: params.textReason,
        }
        if (params.images?.length) body.image = params.images
        const data = await this.httpPost(this.apiUrl('/api/v2/returns/dispute'), body)
        if (data.error) throw new Error(`Shopee returns/dispute: ${data.error} - ${data.message}`)
    }

    /**
     * Real fees + actual payout for an order — GET /api/v2/payment/get_escrow_detail.
     * Returns the escrow (money the seller actually receives) and the platform
     * fees Shopee charged, replacing commissionRate-based estimates.
     */
    async getEscrowDetail(orderSn: string): Promise<{
        escrowAmount: number
        totalFees: number
        commissionFee: number
        serviceFee: number
        transactionFee: number
        buyerTotal: number
        adsVoucherDiscount: number
    } | null> {
        const url = this.apiUrl('/api/v2/payment/get_escrow_detail') + `&order_sn=${orderSn}`
        const data = await this.httpGet(url)
        if (data.error) {
            // Escrow chưa có (đơn chưa đối soát) — không phải lỗi cứng
            console.warn(`[Shopee Escrow] ${orderSn}: ${data.error} - ${data.message}`)
            return null
        }
        const income = data.response?.order_income
        if (!income) return null

        const commissionFee = income.commission_fee || 0
        const serviceFee = income.service_fee || 0
        // Shopee KHÔNG trả `transaction_fee` — trường thật là `seller_transaction_fee`
        // (credit_card_transaction_fee là CÙNG khoản đó, cộng cả hai là đếm 2 lần).
        const transactionFee = income.seller_transaction_fee
            ?? income.credit_card_transaction_fee ?? income.transaction_fee ?? 0
        // Ads Smart Voucher: phần giảm giá do voucher quảng cáo (advertiser tài trợ).
        // Chỉ QUAN SÁT — chưa trừ vào netRevenue cho tới khi xác định seller có gánh hay không.
        const adsVoucherDiscount = data.response?.buyer_payment_info?.ads_voucher_discount || 0
        // PHÍ SÀN = giá bán − thực nhận: gộp trọn mọi khấu trừ (kể cả khoản Shopee
        // không đặt tên riêng), và bảo đảm tổng tiền − phí = thực nhận khớp tuyệt
        // đối. Cộng tay từng khoản có tên thì luôn hụt (case 2026-07: cộng tay ra
        // 239.150 nhưng khấu trừ thật là 255.575).
        const sellingPrice = income.order_selling_price || 0
        const escrowAmount = income.escrow_amount || 0
        const namedFees = commissionFee + serviceFee + transactionFee
        const totalFees = sellingPrice > 0 && escrowAmount > 0
            ? Math.max(0, sellingPrice - escrowAmount)
            : namedFees
        return {
            escrowAmount,
            totalFees,
            commissionFee,
            serviceFee,
            transactionFee,
            buyerTotal: income.buyer_total_amount || 0,
            adsVoucherDiscount,
        }
    }

    /**
     * Push stock for one item — POST /api/v2/product/update_stock.
     * Items WITH variations require model_id; without it Shopee rejects the call,
     * which we surface to the caller per-item.
     */
    async updateStock(itemId: string | number, stock: number, modelId?: string | number): Promise<void> {
        const stockEntry: any = { seller_stock: [{ stock: Math.max(0, Math.floor(stock)) }] }
        if (modelId) stockEntry.model_id = Number(modelId)
        const body = { item_id: Number(itemId), stock_list: [stockEntry] }

        const data = await this.httpPost(this.apiUrl('/api/v2/product/update_stock'), body)
        if (data.error) throw new Error(`Shopee update_stock: ${data.error} - ${data.message}`)
        const fail = data.response?.failure_list?.[0]
        if (fail) throw new Error(`Shopee update_stock item ${itemId}: ${fail.failed_reason || JSON.stringify(fail)}`)
    }

    /**
     * Push price for one item — POST /api/v2/product/update_price.
     * Items WITH variations require model_id (same caveat as updateStock).
     */
    async updatePrice(itemId: string | number, price: number, modelId?: string | number): Promise<void> {
        const priceEntry: any = { original_price: Math.max(0, price) }
        if (modelId) priceEntry.model_id = Number(modelId)
        const body = { item_id: Number(itemId), price_list: [priceEntry] }

        const data = await this.httpPost(this.apiUrl('/api/v2/product/update_price'), body)
        if (data.error) throw new Error(`Shopee update_price: ${data.error} - ${data.message}`)
        const fail = data.response?.failure_list?.[0]
        if (fail) throw new Error(`Shopee update_price item ${itemId}: ${fail.failed_reason || JSON.stringify(fail)}`)
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
    async fetchReturns(params: { since?: Date; until?: Date }) {
        const path = '/api/v2/returns/get_return_list'
        // Mốc kết thúc chọn được (mặc định = bây giờ); không cho vượt hiện tại
        const now = Math.min(
            params.until ? Math.floor(params.until.getTime() / 1000) : Math.floor(Date.now() / 1000),
            Math.floor(Date.now() / 1000),
        )
        const timeFrom = params.since ? Math.floor(params.since.getTime() / 1000) : now - 15 * 86400

        // Shopee CHẶN cửa sổ > 15 ngày ("The period between create_time_from and
        // created_time_of must not more than 15 days") → tự chia khung 14 ngày,
        // nếu không mọi lần kéo quá 15 ngày đều ném lỗi và KHÔNG lấy được phiếu nào.
        const WINDOW = 14 * 86400
        const all: any[] = []
        for (let winFrom = timeFrom; winFrom < now; winFrom += WINDOW) {
            const winTo = Math.min(winFrom + WINDOW, now)
            // Phân trang đầy đủ (trước đây cố định page 1 → quá 50 yêu cầu là sót)
            for (let pageNo = 1; pageNo <= 10; pageNo++) {
                const url = this.apiUrl(path) +
                    `&create_time_from=${winFrom}&create_time_to=${winTo}` +
                    `&page_no=${pageNo}&page_size=50`

                const data = await this.httpGet(url)
                if (data.error) throw new Error(`Shopee getReturns: ${data.error} - ${data.message}`)

                const returnList = data.response?.return || []
                all.push(...returnList)
                if (returnList.length < 50 || !data.response?.more) break
            }
        }
        // Cùng 1 phiếu có thể rơi vào 2 khung (biên) → khử trùng theo return_sn
        const seen = new Set<string>()
        return all
            .filter((r: any) => {
                const k = String(r.return_sn || r.returnsn || '')
                if (!k || seen.has(k)) return false
                seen.add(k); return true
            })
            .map((r: any) => this.mapReturn(r))
    }

    /** CHẨN ĐOÁN: gọi get_return_list và trả NGUYÊN response từng khung/trang
     * (không map, không dedupe) — soi xem Shopee thật sự báo gì. */
    async debugReturnList(since: Date, until?: Date, timeField: 'create_time' | 'update_time' = 'create_time') {
        const path = '/api/v2/returns/get_return_list'
        const now = Math.min(
            until ? Math.floor(until.getTime() / 1000) : Math.floor(Date.now() / 1000),
            Math.floor(Date.now() / 1000),
        )
        const timeFrom = Math.floor(since.getTime() / 1000)
        const WINDOW = 14 * 86400
        const out: any[] = []
        for (let winFrom = timeFrom; winFrom < now; winFrom += WINDOW) {
            const winTo = Math.min(winFrom + WINDOW, now)
            for (let pageNo = 1; pageNo <= 3; pageNo++) {
                const url = this.apiUrl(path) +
                    `&${timeField}_from=${winFrom}&${timeField}_to=${winTo}` +
                    `&page_no=${pageNo}&page_size=50`
                const data = await this.httpGet(url)
                const list = data.response?.return || []
                out.push({
                    truong: timeField,
                    khung: `${new Date(winFrom * 1000).toISOString().slice(0, 10)}→${new Date(winTo * 1000).toISOString().slice(0, 10)}`,
                    trang: pageNo,
                    soPhieu: list.length,
                    more: data.response?.more,
                    loi: data.error || undefined,
                    message: data.message || undefined,
                    maDon: list.map((r: any) => r.order_sn),
                })
                if (list.length < 50 || !data.response?.more) break
            }
        }
        return out
    }

    /** Lấy TỔNG TIỀN HIỆN TẠI của nhiều đơn (tối đa 50/lượt) — Shopee trừ thẳng
     * khoản khách trả vào total_amount, nên so với tổng đã lưu là phát hiện được
     * trả hàng/hoàn tiền kể cả khi get_return_list im lặng. */
    async getOrderTotals(orderSns: string[]): Promise<Record<string, { total: number; status: string; updateTime?: Date }>> {
        const out: Record<string, { total: number; status: string; updateTime?: Date }> = {}
        for (let i = 0; i < orderSns.length; i += 50) {
            const batch = orderSns.slice(i, i + 50)
            const url = this.apiUrl('/api/v2/order/get_order_detail') +
                `&order_sn_list=${batch.join(',')}` +
                `&response_optional_fields=order_status,total_amount`
            const d = await this.httpGet(url)
            if (d.error) throw new Error(`Shopee getOrderTotals: ${d.error} - ${d.message}`)
            for (const o of (d.response?.order_list || [])) {
                out[String(o.order_sn)] = {
                    total: Number(o.total_amount) || 0,
                    status: String(o.order_status || ''),
                    updateTime: o.update_time ? new Date(o.update_time * 1000) : undefined,
                }
            }
        }
        return out
    }

    /**
     * NGÀY KHÁCH NHẬN HÀNG THẬT của đơn Shopee.
     *
     * Chi tiết đơn của Shopee KHÔNG có trường ngày giao (chỉ có create_time,
     * pickup_done_time, ship_by_date, pay_time, update_time — đã dump kiểm chứng
     * 31/07/2026). Mốc giao thành công nằm trong VẬN ĐƠN: sự kiện có
     * logistics_status kiểu DELIVERED/DELIVERY_DONE.
     *
     * Trả null khi chưa giao xong hoặc sàn không có dữ liệu — KHÔNG đoán bừa,
     * vì hàng đợi xuất hoá đơn gom theo ngày này (yêu cầu cơ quan thuế).
     */
    async getDeliveredTime(orderSn: string): Promise<Date | null> {
        const url = this.apiUrl('/api/v2/logistics/get_tracking_info') + `&order_sn=${orderSn}`
        const d = await this.httpGet(url)
        if (d.error) throw new Error(`Shopee tracking: ${d.error} - ${d.message}`)
        const events: any[] = d.response?.tracking_info || []
        const isDone = (s: any) => /DELIVER(ED|Y_DONE)|DELIVERY_SUCCESS/i.test(String(s || ''))
        // Ưu tiên sự kiện GIAO XONG; mảng của Shopee xếp mới→cũ nên lấy mốc SỚM
        // NHẤT trong nhóm giao xong (lần giao thành công đầu tiên).
        const done = events.filter(e => isDone(e.logistics_status) && e.update_time)
        if (done.length > 0) {
            const t = Math.min(...done.map(e => Number(e.update_time)))
            return new Date(t * 1000)
        }
        // Đơn đã ở trạng thái giao xong nhưng sự kiện không ghi rõ → lấy mốc mới nhất
        if (isDone(d.response?.logistics_status) && events.length > 0) {
            const t = Math.max(...events.map(e => Number(e.update_time) || 0))
            if (t > 0) return new Date(t * 1000)
        }
        return null
    }

    /** CHẨN ĐOÁN 3: dump THÔ chi tiết đơn + escrow của 1 mã đơn — soi xem Shopee
     * báo trả hàng/hoàn tiền ở trường nào khi get_return_list im lặng. */
    async debugOrderRaw(orderSn: string) {
        const out: any = {}
        try {
            const url = this.apiUrl('/api/v2/order/get_order_detail') +
                `&order_sn_list=${orderSn}` +
                `&response_optional_fields=order_status,total_amount,buyer_user_id,item_list,payment_method,` +
                `actual_shipping_fee,goods_to_declare,note,pay_time,dropshipper,credit_card_number,cancel_by,cancel_reason,` +
                `fulfillment_flag,pickup_done_time,package_list,invoice_data,checkout_shipping_carrier,reverse_shipping_fee`
            const d = await this.httpGet(url)
            const o = d.response?.order_list?.[0] || {}
            // Dump MỌI trường có dạng THỜI GIAN + liệt kê tất cả khoá — để biết
            // Shopee thật sự cấp mốc "đã giao/hoàn tất" ở đâu, không đoán.
            const times: Record<string, string> = {}
            for (const [k, v] of Object.entries(o)) {
                if (/time|date/i.test(k) && typeof v === 'number' && v > 1_000_000_000) {
                    times[k] = new Date(v * 1000).toISOString()
                } else if (/time|date/i.test(k) && v) {
                    times[k] = String(v).slice(0, 40)
                }
            }
            out.donHang = {
                order_status: o.order_status, total_amount: o.total_amount,
                cacMocThoiGian: times,
                tatCaKhoa: Object.keys(o).sort().join(','),
                loi: d.error || undefined, message: d.message || undefined,
            }
            // Vận đơn: mốc "đã giao" thật nằm ở đây nếu order detail không có
            try {
                const turl = this.apiUrl('/api/v2/logistics/get_tracking_info') + `&order_sn=${orderSn}`
                const t = await this.httpGet(turl)
                const info = t.response?.tracking_info || []
                out.vanDon = {
                    trangThai: t.response?.logistics_status,
                    soMoc: info.length,
                    mocCuoi: info.slice(-3).map((x: any) => ({
                        thoiGian: x.update_time ? new Date(x.update_time * 1000).toISOString() : null,
                        trangThai: x.logistics_status,
                        moTa: String(x.description || '').slice(0, 60),
                    })),
                    loi: t.error || undefined, message: t.message || undefined,
                }
            } catch (e: any) { out.vanDon = { loi: e?.message } }
        } catch (e: any) { out.donHang = { loi: e?.message } }
        try {
            const url = this.apiUrl('/api/v2/payment/get_escrow_detail') + `&order_sn=${orderSn}`
            const d = await this.httpGet(url)
            const r = d.response || {}
            const inc = r.order_income || {}
            // Dump TẤT CẢ trường khác 0 — để phân biệt GIẢM GIÁ (voucher/discount)
            // với HOÀN TIỀN thật; nhìn nhầm là tạo hàng loạt phiếu trả khống.
            out.escrow = {
                khac0: Object.keys(inc).filter(k => inc[k] !== 0 && inc[k] !== '' && inc[k] != null)
                    .map(k => `${k}=${JSON.stringify(inc[k])}`.slice(0, 90)),
                loi: d.error || undefined, message: d.message || undefined,
            }
            out.itemList = (r.order_income?.items || []).map((i: any) =>
                `${i.item_name?.slice(0, 25)}|sl=${i.quantity_purchased}|giaGoc=${i.original_price}|giaBan=${i.discounted_price}|khuyenMai=${i.seller_discount}`)
        } catch (e: any) { out.escrow = { loi: e?.message } }
        return out
    }

    /** CHẨN ĐOÁN 2: quét TỪNG TRẠNG THÁI trong 1 khung ngày — Shopee có thể ẩn
     * phiếu chưa chốt khi không truyền status. */
    async debugReturnByStatus(since: Date, until?: Date) {
        const path = '/api/v2/returns/get_return_list'
        const to = Math.min(
            until ? Math.floor(until.getTime() / 1000) : Math.floor(Date.now() / 1000),
            Math.floor(Date.now() / 1000),
        )
        const from = Math.max(Math.floor(since.getTime() / 1000), to - 14 * 86400)
        const STATUSES = ['', 'REQUESTED', 'PROCESSING', 'ACCEPTED', 'JUDGING', 'CANCELLED', 'CLOSED', 'SELLER_DISPUTE']
        const out: any[] = []
        for (const st of STATUSES) {
            const url = this.apiUrl(path) +
                `&create_time_from=${from}&create_time_to=${to}&page_no=1&page_size=50` +
                (st ? `&status=${st}` : '')
            try {
                const data = await this.httpGet(url)
                const list = data.response?.return || []
                out.push({
                    status: st || '(khong truyen)',
                    soPhieu: list.length,
                    loi: data.error || undefined,
                    message: data.message ? String(data.message).slice(0, 120) : undefined,
                    maDon: list.slice(0, 8).map((r: any) => r.order_sn),
                })
            } catch (e: any) { out.push({ status: st || '(khong truyen)', loi: e?.message }) }
        }
        return { khung: `${new Date(from * 1000).toISOString().slice(0, 10)}→${new Date(to * 1000).toISOString().slice(0, 10)}`, ketQua: out }
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
        // Shopee caps page_size at 60 — anything larger returns param_error
        const pageSize = Math.min(params.pageSize || 60, 60)

        // Auto-paginate to collect ALL conversations
        let allConvs: any[] = []
        let nextOffset: string | undefined = undefined
        let pageCount = 0
        const maxPages = 10 // Safety limit

        do {
            // `direction` là tham số BẮT BUỘC của Shopee (thiếu → param_error):
            // 'latest' cho trang đầu, 'older' + next_timestamp_nano khi phân trang.
            let url = this.apiUrl(path) +
                `&direction=${nextOffset ? 'older' : 'latest'}` +
                `&type=${params.type || 'all'}` +
                `&page_size=${pageSize}`
            if (nextOffset) url += `&next_timestamp_nano=${encodeURIComponent(nextOffset)}`

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

            nextOffset = resp.page_result?.next_offset
                || resp.page_result?.next_cursor?.next_message_time_nano
                || resp.next_offset
            const hasMore = resp.page_result?.more || resp.more || false
            pageCount++

            if (!hasMore || !nextOffset || pageCount >= maxPages) break
        } while (true)

        console.log(`[Shopee Chat] Total conversations collected: ${allConvs.length} from ${pageCount} pages`)

        // Khử trùng lặp: trang phân trang của Shopee chồng mép (item cuối trang N
        // lặp lại ở trang N+1) → cùng conversation_id xuất hiện 2 lần trên UI.
        const seen = new Set<string>()
        allConvs = allConvs.filter((c: any) => {
            const id = String(c.conversation_id || '')
            if (!id || seen.has(id)) return false
            seen.add(id)
            return true
        })

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

    // ─── Flash Sale (v2.shop_flash_sale) ─────────────────────────────────────────
    // Shop-type API — ký y hệt order (apiUrl). LƯU Ý nghiệp vụ: Shopee GIỮ TỒN
    // campaign ngay khi thêm item vào flash sale → không được tạo trước hàng loạt;
    // cron flashSaleScheduler chỉ đẩy sale kế tiếp lên Shopee sau khi sale trước
    // kết thúc (yêu cầu "hết flash sale này mới tới flash sale sau").

    /** Khung giờ flash sale còn đăng ký được trong [from, to] (unix seconds). */
    async flashSaleGetTimeSlots(fromUnix: number, toUnix: number): Promise<{ timeslot_id: number; start_time: number; end_time: number }[]> {
        const path = '/api/v2/shop_flash_sale/get_time_slot_id'
        const url = `${this.apiUrl(path)}&start_time=${fromUnix}&end_time=${toUnix}`
        const data = await this.httpGet(url)
        if (data.error) throw new Error(`Shopee get_time_slot_id: ${data.error} - ${data.message}`)
        return data.response || []
    }

    /** Tạo flash sale rỗng cho 1 khung giờ → flash_sale_id. */
    async flashSaleCreate(timeslotId: number): Promise<number> {
        const data = await this.httpPost(this.apiUrl('/api/v2/shop_flash_sale/create_shop_flash_sale'), {
            timeslot_id: timeslotId,
        })
        if (data.error) throw new Error(`Shopee create_shop_flash_sale: ${data.error} - ${data.message}`)
        return data.response?.flash_sale_id
    }

    /**
     * Thêm items vào flash sale. items theo shape Shopee:
     * [{ item_id, purchase_limit, models: [{ model_id, input_promo_price, stock }] }]
     * Trả về danh sách bị Shopee từ chối (failed_items) để hiển thị lý do.
     */
    async flashSaleAddItems(flashSaleId: number, items: any[]): Promise<{ failedItems: any[] }> {
        const data = await this.httpPost(this.apiUrl('/api/v2/shop_flash_sale/add_shop_flash_sale_items'), {
            flash_sale_id: flashSaleId,
            items,
        })
        if (data.error) throw new Error(`Shopee add_shop_flash_sale_items: ${data.error} - ${data.message}`)
        return { failedItems: data.response?.failed_items || [] }
    }

    /** Bật (1) / tắt (2) flash sale. */
    async flashSaleUpdateStatus(flashSaleId: number, status: 1 | 2): Promise<void> {
        const data = await this.httpPost(this.apiUrl('/api/v2/shop_flash_sale/update_shop_flash_sale'), {
            flash_sale_id: flashSaleId,
            status,
        })
        if (data.error) throw new Error(`Shopee update_shop_flash_sale: ${data.error} - ${data.message}`)
    }

    /** Chi tiết 1 flash sale (status: 1 upcoming, 2 ongoing, 3 rejected, 4 ended...). */
    async flashSaleGet(flashSaleId: number): Promise<any> {
        const url = `${this.apiUrl('/api/v2/shop_flash_sale/get_shop_flash_sale')}&flash_sale_id=${flashSaleId}`
        const data = await this.httpGet(url)
        if (data.error) throw new Error(`Shopee get_shop_flash_sale: ${data.error} - ${data.message}`)
        return data.response
    }

    /** Xoá flash sale (chỉ sale chưa diễn ra). */
    async flashSaleDelete(flashSaleId: number): Promise<void> {
        const data = await this.httpPost(this.apiUrl('/api/v2/shop_flash_sale/delete_shop_flash_sale'), {
            flash_sale_id: flashSaleId,
        })
        if (data.error) throw new Error(`Shopee delete_shop_flash_sale: ${data.error} - ${data.message}`)
    }

    /**
     * Model list của 1 item (để build models[] cho add items — mỗi model cần
     * input_promo_price + stock riêng). Item không phân loại → mảng rỗng.
     */
    async getModelList(itemId: number): Promise<{ model_id: number; price: number; stock: number; name: string }[]> {
        const url = `${this.apiUrl('/api/v2/product/get_model_list')}&item_id=${itemId}`
        const data = await this.httpGet(url)
        if (data.error) throw new Error(`Shopee get_model_list: ${data.error} - ${data.message}`)
        const models = data.response?.model || []
        return models.map((m: any) => ({
            model_id: m.model_id,
            name: m.model_name || '',
            // GIÁ GỐC làm chuẩn tính % giảm flash sale (Shopee validate 5–90% so
            // với original_price; current_price có thể đã dính KM khác → sai chuẩn).
            price: m.price_info?.[0]?.original_price ?? m.price_info?.[0]?.current_price ?? 0,
            stock: m.stock_info_v2?.seller_stock?.[0]?.stock ?? m.stock_info?.[0]?.current_stock ?? 0,
        }))
    }
}
