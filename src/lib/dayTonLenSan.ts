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
//
//  HAI LƯỢT + CẦU DAO CHUNG (09/11/2026): lượt 1 tính tồn cần đẩy cho MỌI listing
//  (chưa gọi sàn), cầu dao soát trên TOÀN BỘ, lượt 2 mới đẩy. Trước đó vòng lặp vừa
//  tính vừa đẩy — không có chỗ dừng trước lần ghi đầu; cầu dao chỉ có ở Pilot và chỉ
//  thấy 300 dòng đầu của bảng chạy thử; nút "Đẩy tồn kho lên sàn" không có cầu dao
//  nào. Sửa đọc tồn Shopee (services/platforms/shopee.ts — trước lưu 0 ở mọi listing)
//  mà nút tay chưa có cầu dao thì MỘT lần bấm ở KENGISTORE (kho mẹ đang tắt, hàng thật
//  nằm ở HUTI) đưa ~438/709 listing về 0. Nay mọi đường — nút tay, /admin/day-ton-thu,
//  Pilot — qua cùng cầu dao; chỉ người bấm nút tay vượt được, bằng cờ chapNhanVeKhong.
// ═══════════════════════════════════════════════════════════════════════════════

import { getPlatformService } from '../services/platforms'
import type { KhoMe } from './khoMe'

export interface ThamSoDayTon {
    dryRun?: boolean
    /** Chỉ đẩy đúng mấy listing này. Trống = cả kênh. */
    onlineProductIds?: string[]
    /** Bỏ qua bước "tồn sàn đã bằng tồn cần đẩy thì thôi". */
    force?: boolean
    /** Người bấm nút tay đã xem chạy thử và tích "vẫn đẩy các mã về 0" (09/11/2026) ⇒ cầu dao nhảy vẫn đẩy.
     *  CHỈ route push-stock truyền. Pilot (shopeePilot.dayTonChuKy) KHÔNG BAO GIỜ truyền: máy không được tự
     *  nhận rủi ro khoá sạch hàng đang bán — cầu dao nhảy thì chờ người. */
    chapNhanVeKhong?: boolean
    /** Số mã về 0 người bấm ĐÃ THẤY ở lượt chạy thử (data.veKhong) — bắt buộc đi kèm chapNhanVeKhong (09/11/2026): đồng ý
     *  là đồng ý với con số đã xem. Tồn đổi giữa lúc xem và lúc bấm làm thêm mã về 0 ⇒ 409, phải xem lại; thiếu số ⇒ coi
     *  như chưa đồng ý. */
    veKhongDaXem?: number
    /** CHỈ cho bộ kiểm (scripts/check-pilot-tu-dong.ts, mục N) — route và Pilot không bao giờ truyền: dịch vụ
     *  sàn giả thay getPlatformService (không làm mới token, không giãn nhịp 300ms) và kho mẹ giả thay moKhoMe
     *  (bỏ trống = không có kho mẹ) — để bộ kiểm không chạm registry / CSDL thật. */
    giaLap?: { dichVu: any; khoMe?: KhoMe | null }
}

/**
 * Kết quả trả về route (09/11/2026):
 *  - chạy thử: data = { chayThu, seDay, seBoQua, [khoMe, boQuaViKhongCoOKhoMe, viDuBoQua], cauDao (string|null), veKhong,
 *    coHangTrenSan, viDuVeKhong (≤ 20 { sku, tenSan, tonDangTrenSan }), bang (≤ 300 dòng), ghiChu }
 *  - cầu dao chặn chạy thật: http 409, ok false, loi 'CẦU DAO — không đẩy tồn: …', data = { cauDao, veKhong, coHangTrenSan, viDuVeKhong }
 *  - chạy thật: data = { pushed, skipped, failed, errors, veKhong, [cauDao khi người bấm đã vượt], [khoMe…] }
 */
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

/** Dòng bảng đẩy tồn có hàng trên sàn — gốc của tỷ lệ cầu dao. */
const coHangSan = (x: any) => Number(x?.tonDangTrenSan) > 0
/** Dòng sẽ đẩy (không bỏ qua) mà đưa một mã ĐANG CÓ HÀNG trên sàn về 0. */
const seVeKhong = (x: any) => !x?.boQua && Number(x?.seDay) === 0 && coHangSan(x)

/**
 * Cầu dao đẩy tồn (03/11/2026): lượt đẩy làm NHIỀU mã đang có hàng trên sàn về 0 thì gần như chắc là tồn kho sai chỗ chứ
 * không phải bán hết — đo KENGISTORE: TikTok 117 mã sẽ về 0 vì hàng nằm ở kho HUTI mà kho mẹ đang tắt.
 * Ngưỡng ≥ max(5, 15%) số mã đang có hàng trên sàn; bán hết lẻ tẻ vẫn đẩy bình thường. null = cho đẩy.
 * 09/11/2026: chuyển từ shopeePilot.ts về lõi đẩy tồn (shopeePilot re-export cho người gọi cũ) — lõi soát trên TOÀN BỘ
 * listing trước khi gọi sàn, nút tay cũng qua đây. Ngữ nghĩa + chữ giữ nguyên: "đẩy tay ở Kênh bán online" giờ là chạy thử,
 * xem ví dụ, tích xác nhận.
 */
export function cauDaoTon(bang: any[]): string | null {
    const ds = Array.isArray(bang) ? bang : []
    const coHang = ds.filter(coHangSan).length
    const veKhong = ds.filter(seVeKhong)
    if (veKhong.length < Math.max(5, Math.ceil(coHang * 0.15))) return null
    return `${veKhong.length}/${coHang} mã đang có hàng trên sàn sẽ về 0 (vd ${veKhong.slice(0, 4).map(x => `${x.sku} ${x.tonDangTrenSan}→0`).join(', ')}) — ` +
        'thường là tồn kho sai chỗ (hàng nằm ở kho khác / kho mẹ đang tắt). Kiểm rồi đẩy tay ở Kênh bán online.'
}

export async function dayTonLenSan(prisma: any, channelId: string, ts: ThamSoDayTon = {}): Promise<KetQuaDayTon> {
    const channel = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
    if (!channel) return { http: 404, ok: false, loi: 'Kênh không tồn tại' }
    if (!['shopee', 'tiktok'].includes(channel.platform)) {
        return { http: 400, ok: false, loi: `Nền tảng ${channel.platform} chưa hỗ trợ đẩy tồn kho` }
    }
    if (!channel.accessToken) return { http: 400, ok: false, loi: 'Kênh chưa kết nối API (thiếu access token)' }

    const giaLap = ts.giaLap
    const service = (giaLap ? giaLap.dichVu : getPlatformService(channel.platform, {
        apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
        accessToken: channel.accessToken || undefined,
        refreshToken: channel.refreshToken || undefined,
        shopId: channel.shopId || undefined,
    })) as any
    if (!service) return { http: 400, ok: false, loi: 'Nền tảng chưa được hỗ trợ' }

    const chayThu = ts.dryRun === true
    const force = ts.force === true

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
    const khoMe = giaLap ? (giaLap.khoMe ?? null) : await moKhoMe(prisma)
    const donTreo = khoMe ? await donTreoTheoSku(prisma) : new Map<string, number>()
    const boQuaKhoMe: string[] = []
    if (khoMe) console.log(`[push-stock] ${channel.name}: lấy tồn từ kho mẹ ${khoMe.ma}, trừ ${donTreo.size} mã có đơn treo`)

    /* LƯỢT 1 — tính tồn cần đẩy cho MỌI listing, CHƯA gọi sàn. Chạy thử và chạy thật dùng CHUNG lượt này (một bản tính
     * ⇒ bảng xem trước đúng bằng thứ sẽ đẩy). `dong` là dòng bảng chạy thử — cầu dao đọc trên đủ mọi dòng, không cắt. */
    const keHoach: { p: any; local: any; targetStock: number; dong: any }[] = []
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
        let treo = 0
        if (khoMe) {
            const hangMe = await timHangMeFn(khoMe.sp, local.sku)
            if (!hangMe) {
                skipped++
                boQuaKhoMe.push(`${p.sku || local.sku || p.platformProductId}: không tra ra hàng ở kho mẹ ${khoMe.ma}`)
                continue
            }
            treo = donTreo.get(String(local.sku || '').trim().toLowerCase()) || 0
            tonNguon = (hangMe.stock || 0) - treo
        }

        // Tồn theo ĐƠN VỊ BÁN trên sàn: 26 cái = 2 vỉ (không phải 26 vỉ)
        const targetStock = Math.max(0, Math.floor(tonNguon / (rate > 0 ? rate : 1)))
        const boQua = !force && p.stock === targetStock
        if (boQua) skipped++
        keHoach.push({
            p, local, targetStock,
            dong: {
                sku: p.sku || local.sku, tenSan: String(p.name || '').slice(0, 40),
                tonDangTrenSan: p.stock, seDay: targetStock,
                doi: targetStock - (p.stock || 0),
                ...(khoMe ? { tonKhoMe: tonNguon + treo, donTreo: treo } : {}),
                ...(rate !== 1 ? { heSo: rate } : {}),
                boQua,
            },
        })
    }

    /* CẦU DAO trên TOÀN BỘ lượt 1 (09/11/2026) — trước Pilot chỉ soát `bang` đã cắt 300 dòng: gian 709 listing mà các mã
     * về 0 nằm sau dòng 300 thì cầu dao không thấy. Chạy thử trả kèm chi tiết để giao diện hỏi lại người bấm. */
    const bangDu = keHoach.map(k => k.dong)
    const cauDao = cauDaoTon(bangDu)
    const dsVeKhong = bangDu.filter(seVeKhong)
    const chiTietCauDao = {
        cauDao,
        veKhong: dsVeKhong.length,
        coHangTrenSan: bangDu.filter(coHangSan).length,
        viDuVeKhong: dsVeKhong.slice(0, 20).map(x => ({ sku: x.sku, tenSan: x.tenSan, tonDangTrenSan: x.tonDangTrenSan })),
    }

    if (chayThu) {
        return {
            http: 200, ok: true,
            data: {
                chayThu: true,
                seDay: keHoach.length - keHoach.filter(k => k.dong.boQua).length, seBoQua: skipped,
                ...(khoMe ? { khoMe: khoMe.ma, boQuaViKhongCoOKhoMe: boQuaKhoMe.length, viDuBoQua: boQuaKhoMe.slice(0, 10) } : {}),
                ...chiTietCauDao,
                // bảng cho giao diện vẫn cắt 300 dòng — cầu dao ở trên đã đếm trên đủ mọi dòng
                bang: bangDu.slice(0, 300),
                ghiChu: 'CHẠY THỬ — chưa gọi sàn, chưa ghi gì. Bỏ dryRun để chạy thật.',
            },
        }
    }

    /* Chạy thật mà cầu dao nhảy: KHÔNG gọi sàn lần nào. Chỉ người bấm nút tay — đã xem chạy thử, tích "vẫn đẩy các mã
     * về 0" — vượt được (chapNhanVeKhong); Pilot không truyền cờ nên luôn dừng ở đây khi tồn đổi giữa chạy thử và chạy thật. */
    // Đồng ý gắn với con số đã xem: thêm mã về 0 sau lúc xem trước (hoặc không gửi số) ⇒ không tính là đồng ý
    const daXem = typeof ts.veKhongDaXem === 'number' && Number.isFinite(ts.veKhongDaXem) ? ts.veKhongDaXem : null
    const vuotCauDao = !!cauDao && ts.chapNhanVeKhong === true && daXem !== null && chiTietCauDao.veKhong <= daXem
    if (cauDao && !vuotCauDao) {
        console.warn(`[push-stock] ${channel.name}: CẦU DAO — ${chiTietCauDao.veKhong}/${chiTietCauDao.coHangTrenSan} mã đang có hàng sẽ về 0, không đẩy`)
        const xemLai = ts.chapNhanVeKhong === true
            ? (daXem === null ? 'thiếu số mã về 0 đã xem ở lượt chạy thử — chạy thử lại rồi xác nhận. '
                : `số mã về 0 tăng từ ${daXem} lên ${chiTietCauDao.veKhong} kể từ lúc xem trước — xem lại rồi mới xác nhận. `)
            : ''
        return { http: 409, ok: false, loi: `CẦU DAO — không đẩy tồn: ${xemLai}${cauDao}`, data: chiTietCauDao }
    }

    /* LƯỢT 2 — đẩy thật. Token làm mới ở đây (đệm 5 phút): chạy thử / cầu dao chặn thì khỏi đụng token —
     * chạy thử đúng nghĩa "chưa gọi sàn, chưa ghi gì". */
    const tokenExpiresAt = (channel as any).tokenExpiresAt
    if (!giaLap && tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
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

    for (const { p, local, targetStock, dong } of keHoach) {
        if (dong.boQua) continue

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

        // Giãn nhịp giữa hai lời gọi sàn để không chạm trần tần suất (sàn giả của bộ kiểm không có trần)
        if (!giaLap) await new Promise(r => setTimeout(r, 300))
    }

    await prisma.syncLog.create({
        data: {
            channelId: channel.id,
            action: 'push_stock',
            status: failed > 0 ? 'partial' : 'success',
            details: `Pushed: ${pushed}, skipped: ${skipped}, failed: ${failed}`
                + (khoMe ? ` | kho mẹ ${khoMe.ma}, bỏ qua ${boQuaKhoMe.length} mã không có bên đó` : '')
                // vượt cầu dao phải để lại dấu — sau này hỏi "ai cho đẩy về 0" thì sổ đồng bộ trả lời được
                + (vuotCauDao ? ` | VƯỢT CẦU DAO theo xác nhận của người bấm: ${chiTietCauDao.veKhong}/${chiTietCauDao.coHangTrenSan} mã đang có hàng đẩy về 0` : '')
                + (errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''),
            ordersCount: pushed,
        },
    }).catch(() => { })

    return {
        http: 200, ok: true,
        data: {
            pushed, skipped, failed, errors,
            // số mã đang có hàng trên sàn được đẩy về 0 — người bấm biết lượt vừa rồi khoá bao nhiêu mã
            veKhong: chiTietCauDao.veKhong,
            ...(vuotCauDao ? { cauDao } : {}),
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
