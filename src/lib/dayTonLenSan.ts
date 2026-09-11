// ═══════════════════════════════════════════════════════════════════════════════
//  ĐẨY TỒN KHO LÊN SÀN — lõi dùng chung
//
//  Tách khỏi `POST /online-orders/channels/:id/push-stock` (11/09/2026) để bộ đo
//  của admin gọi được ĐÚNG đường mà nút trên web gọi. Chủ shop muốn thử 1 SKU mà
//  đường kia đòi đăng nhập cửa hàng; viết bản thứ hai cho admin là cách chắc chắn
//  nhất để hai bên đẩy ra hai con số khác nhau — đúng bệnh "hai router cùng đường".
//
//  ⚠ ĐÂY LÀ THAO TÁC KHÔNG CÓ ĐƯỜNG LUI: gọi thẳng API sàn, đẩy nhầm số 0 là khoá
//  sạch hàng đang bán. Vì vậy có `dryRun` tính y hệt lượt thật nhưng không gọi sàn.
// ═══════════════════════════════════════════════════════════════════════════════

import { getPlatformService } from '../services/platforms'

export interface ThamSoDayTon {
    dryRun?: boolean
    /** Chỉ đẩy đúng mấy listing này. Trống = cả kênh. */
    onlineProductIds?: string[]
    /** Bỏ qua bước "tồn sàn đã bằng tồn cần đẩy thì thôi". */
    force?: boolean
}

export interface KetQuaDayTon {
    http: number
    ok: boolean
    loi?: string
    data?: any
}

/**
 * Đẩy tồn MỘT listing Shopee, tự xử hàng CÓ PHÂN LOẠI.
 *
 * Đo 11/09/2026: listing SHD1072 (item 16994673670) có HAI phân loại mang HAI mã
 * kho khác nhau — "Hồng" sku SHD1072 và "Tím" sku SHD2011. Shopee bắt buộc gửi
 * `model_id` cho hàng kiểu này, gửi thiếu thì trả
 * "model_id is mandatory if item is under model level" và KHÔNG đẩy được gì.
 *
 * Vì sao thử trước rồi mới hỏi phân loại, thay vì luôn hỏi: hàng KHÔNG phân loại
 * chiếm phần lớn và chúng đẩy được ngay; hỏi danh sách phân loại cho cả 709 listing
 * là 709 lời gọi thừa, đủ để chạm trần tần suất của Shopee.
 *
 * Ghép phân loại CHỈ theo SKU, và chỉ nhận khi khớp DUY NHẤT. Đẩy tồn vào nhầm
 * phân loại là sai tồn của một mặt hàng KHÁC — ở đây là SHD2011 — nên thà báo lỗi
 * còn hơn đoán.
 */
async function dayTonShopee(service: any, p: any, local: any, targetStock: number): Promise<void> {
    try {
        await service.updateStock(p.platformProductId, targetStock)
        return
    } catch (e: any) {
        if (!/model_id is mandatory|under model level/i.test(String(e?.message || ''))) throw e
    }

    const models: any[] = await service.getModelList(Number(p.platformProductId))
    if (models.length === 0) {
        throw new Error('Shopee đòi model_id nhưng get_model_list trả rỗng — không rõ phân loại, không đẩy')
    }

    const canhSku = [String(p.sku || '').trim().toLowerCase(), String(local?.sku || '').trim().toLowerCase()]
        .filter(Boolean)
    const khop = models.filter(m => canhSku.includes(String(m.sku || '').trim().toLowerCase()))

    let modelId: number | null = null
    if (khop.length === 1) modelId = khop[0].model_id
    else if (khop.length === 0 && models.length === 1) modelId = models[0].model_id

    if (!modelId) {
        const mota = models.map(m => `${m.sku || '(không mã)'}→${m.model_id}`).join(', ')
        throw new Error(khop.length > 1
            ? `SKU "${p.sku || local?.sku}" khớp ${khop.length} phân loại (${mota}) — KHÔNG đoán, phải khai tay`
            : `listing có ${models.length} phân loại (${mota}), không cái nào mang SKU "${p.sku || local?.sku}" — KHÔNG đoán, phải khai tay`)
    }
    await service.updateStock(p.platformProductId, targetStock, modelId)
}

export async function dayTonLenSan(prisma: any, channelId: string, ts: ThamSoDayTon = {}): Promise<KetQuaDayTon> {
    const channel = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
    if (!channel) return { http: 404, ok: false, loi: 'Kênh không tồn tại' }
    if (!['shopee', 'tiktok'].includes(channel.platform)) {
        return { http: 400, ok: false, loi: `Nền tảng ${channel.platform} chưa hỗ trợ đẩy tồn kho` }
    }
    if (!channel.accessToken) return { http: 400, ok: false, loi: 'Kênh chưa kết nối API (thiếu access token)' }

    const service = getPlatformService(channel.platform, {
        apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
        accessToken: channel.accessToken || undefined,
        refreshToken: channel.refreshToken || undefined,
        shopId: channel.shopId || undefined,
    }) as any
    if (!service) return { http: 400, ok: false, loi: 'Nền tảng chưa được hỗ trợ' }

    // Làm mới token nếu sắp hết hạn (đệm 5 phút)
    const tokenExpiresAt = (channel as any).tokenExpiresAt
    if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
        try {
            const tokens = await service.refreshAccessToken()
            service.credentials.accessToken = tokens.accessToken
            service.credentials.refreshToken = tokens.refreshToken
            await prisma.onlineChannel.update({
                where: { id: channel.id },
                data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
            })
        } catch (e: any) { console.warn('[push-stock] Token refresh failed:', e.message) }
    }

    const chayThu = ts.dryRun === true
    const force = ts.force === true
    const bangThu: any[] = []

    const where: any = { channelId: channel.id }
    if (Array.isArray(ts.onlineProductIds) && ts.onlineProductIds.length > 0) {
        where.id = { in: ts.onlineProductIds.map(String) }
    }

    const onlineProducts = await prisma.onlineProduct.findMany({
        where,
        include: { localProduct: { select: { id: true, sku: true, stock: true } } },
    })

    let pushed = 0, skipped = 0, failed = 0
    const errors: string[] = []

    /* Kho mẹ mở MỘT LẦN cho cả lượt: `moKhoMe` tra registry, gọi trong vòng lặp
     * 700 listing là 700 truy vấn thừa. Đơn treo cũng gộp sẵn một lượt. */
    const { moKhoMe, timHangMe: timHangMeFn, donTreoTheoSku } = await import('./khoMe')
    const khoMe = await moKhoMe(prisma)
    const donTreo = khoMe ? await donTreoTheoSku(prisma) : new Map<string, number>()
    const boQuaKhoMe: string[] = []
    if (khoMe) console.log(`[push-stock] ${channel.name}: lấy tồn từ kho mẹ ${khoMe.ma}, trừ ${donTreo.size} mã có đơn treo`)

    for (const p of onlineProducts) {
        // Tra hàng kho: link sẵn → khớp SKU → BẢNG ÁNH XẠ. Thiếu bước ánh xạ thì
        // phân loại có mã riêng (combo/vỉ) không bao giờ đẩy được tồn, và im lặng
        // bỏ qua nên rất khó phát hiện.
        let local: any = p.localProduct
        // rate = số ĐƠN VỊ GỐC trong 1 đơn vị bán trên sàn (1 vỉ = 10 cái)
        let rate = 1
        if (!local && p.sku) {
            local = await prisma.product.findFirst({
                where: { sku: p.sku },
                select: { id: true, sku: true, stock: true, mergedIntoId: true, mergedRate: true },
            })
        }
        if (!local && p.sku) {
            const m = await prisma.skuMapping.findFirst({
                where: { platformSku: { equals: p.sku, mode: 'insensitive' } },
            }).catch(() => null)
            if (m?.productId) {
                rate = Number((m as any).conversionRate) || 1
                local = await prisma.product.findUnique({
                    where: { id: m.productId },
                    select: { id: true, sku: true, stock: true, mergedIntoId: true, mergedRate: true },
                })
            }
        }
        // Mã ĐÃ GỘP: tồn nằm ở mã đích, quy đổi theo hệ số đã ghi
        if (local?.mergedIntoId) {
            rate *= Number(local.mergedRate) || 1
            local = await prisma.product.findUnique({
                where: { id: local.mergedIntoId },
                select: { id: true, sku: true, stock: true, mergedIntoId: true, mergedRate: true },
            })
        }
        if (!local) { skipped++; continue }

        /* KHO MẸ — cửa hàng mượn tồn của cửa hàng khác thì đẩy TỒN BÊN ĐÓ.
         * Số đẩy = tồn mẹ − ĐƠN TREO bên này (chủ shop chốt 10/09/2026).
         * Không tra ra hàng bên mẹ thì BỎ QUA hẳn listing, KHÔNG rơi về tồn kho con:
         * tồn con ở cửa hàng mượn kho là 0/âm, đẩy lên là khoá sạch hàng đang bán. */
        let tonNguon = local.stock || 0
        if (khoMe) {
            const hangMe = await timHangMeFn(khoMe.sp, local.sku)
            if (!hangMe) {
                skipped++
                boQuaKhoMe.push(`${p.sku || local.sku || p.platformProductId}: không tra ra hàng ở kho mẹ ${khoMe.ma}`)
                continue
            }
            const treo = donTreo.get(String(local.sku || '').trim().toLowerCase()) || 0
            tonNguon = (hangMe.stock || 0) - treo
        }

        // Tồn theo ĐƠN VỊ BÁN trên sàn: 26 cái = 2 vỉ (không phải 26 vỉ)
        const targetStock = Math.max(0, Math.floor(tonNguon / (rate > 0 ? rate : 1)))

        if (chayThu) {
            if (bangThu.length < 300) {
                bangThu.push({
                    sku: p.sku || local.sku, tenSan: String(p.name || '').slice(0, 40),
                    tonDangTrenSan: p.stock, seDay: targetStock,
                    doi: targetStock - (p.stock || 0),
                    ...(khoMe ? { tonKhoMe: tonNguon + (donTreo.get(String(local.sku || '').trim().toLowerCase()) || 0), donTreo: donTreo.get(String(local.sku || '').trim().toLowerCase()) || 0 } : {}),
                    ...(rate !== 1 ? { heSo: rate } : {}),
                    boQua: !force && p.stock === targetStock,
                })
            }
            if (!force && p.stock === targetStock) skipped++; else pushed++
            continue
        }

        if (!force && p.stock === targetStock) { skipped++; continue }

        try {
            if (channel.platform === 'shopee') {
                await dayTonShopee(service, p, local, targetStock)
            } else {
                await service.updateStock(p.platformProductId, targetStock, undefined, p.sku || undefined)
            }
            await prisma.onlineProduct.update({
                where: { id: p.id },
                data: { stock: targetStock, syncedAt: new Date() },
            })
            pushed++
        } catch (e: any) {
            failed++
            errors.push(`${p.sku || p.platformProductId}: ${e.message}`)
            console.error(`[push-stock] ${channel.name} ${p.platformProductId}:`, e.message)
        }

        // Giãn nhịp giữa hai lời gọi sàn để không chạm trần tần suất
        await new Promise(r => setTimeout(r, 300))
    }

    if (chayThu) {
        return {
            http: 200, ok: true,
            data: {
                chayThu: true,
                seDay: pushed, seBoQua: skipped,
                ...(khoMe ? { khoMe: khoMe.ma, boQuaViKhongCoOKhoMe: boQuaKhoMe.length, viDuBoQua: boQuaKhoMe.slice(0, 10) } : {}),
                bang: bangThu,
                ghiChu: 'CHẠY THỬ — chưa gọi sàn, chưa ghi gì. Bỏ dryRun để chạy thật.',
            },
        }
    }

    await prisma.syncLog.create({
        data: {
            channelId: channel.id,
            action: 'push_stock',
            status: failed > 0 ? 'partial' : 'success',
            details: `Pushed: ${pushed}, skipped: ${skipped}, failed: ${failed}`
                + (khoMe ? ` | kho mẹ ${khoMe.ma}, bỏ qua ${boQuaKhoMe.length} mã không có bên đó` : '')
                + (errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''),
            ordersCount: pushed,
        },
    }).catch(() => { })

    return {
        http: 200, ok: true,
        data: {
            pushed, skipped, failed, errors,
            // Nói RA khi đang lấy tồn từ kho khác — người bấm nút phải biết số vừa
            // đẩy lên sàn đến từ đâu, và mã nào bị bỏ vì không tra ra bên đó.
            ...(khoMe ? {
                khoMe: khoMe.ma,
                soMaCoDonTreo: donTreo.size,
                boQuaViKhongCoOKhoMe: boQuaKhoMe.length,
                viDuBoQua: boQuaKhoMe.slice(0, 10),
            } : {}),
        },
    }
}
