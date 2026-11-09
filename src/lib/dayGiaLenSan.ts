// ═══════════════════════════════════════════════════════════════════════════════
//  ĐẨY GIÁ BÁN LÊN SÀN — lõi của nút "Đẩy giá lên sàn" (09/11/2026)
//
//  Tách khỏi `POST /online-orders/channels/:id/push-price` như lib/dayTonLenSan tách
//  push-stock: route chỉ gọi, bộ kiểm (scripts/check-pilot-tu-dong.ts, mục P) gọi
//  đúng đường này — không có bản thứ hai để hai bên ra hai con số.
//
//  Nút cũ đẩy GIÁ BÁN LẺ POS (Product.sellingPrice) lên MỌI listing, không soát gì.
//  Giá lẻ ở quầy không gánh phí sàn (~20–30% ở Shopee / TikTok) ⇒ một lần bấm có thể
//  đưa cả gian xuống dưới giá vốn + phí mà không ai hay. Nay MỖI listing soát GIÁ SÀN
//  trước khi ghi, cùng phép tính với Pilot:
//    - phí theo NGÀNH của listing (docMauPhiTheoNganh(...).chon(categoryId)) — gian
//      chưa đủ đơn để đo, chưa khai phí ⇒ CHƯA BIẾT PHÍ ⇒ không mã nào ghi được;
//    - giá vốn MỘT đơn vị bán (giaVonHangLoat — cùng chuỗi tra với đẩy tồn: nối sẵn →
//      cùng SKU → ánh xạ SKU × hệ số → mã đã gộp);
//    - chính sách giá của Pilot CÙNG SÀN nếu cửa hàng đã lưu (biên tối thiểu, đóng gói,
//      quảng cáo, affiliate, thuế GTGT), không thì mặc định 15% / 5%.
//  Dưới giá sàn / thiếu giá vốn / chưa biết phí ⇒ BỎ QUA mã đó, kèm lý do. Không có cờ
//  vượt: Pilot (người lẫn máy) cũng không ghi được giá dưới sàn (giaShopee.chanGiaDuoiSan).
//
//  Kết quả (data):
//   - chạy thử: { chayThu, seDay, seBoQua, boQuaDuoiSan, demBoQua, viDuBoQua, viDuDoi, [chuaBietPhi], ghiChu }
//   - chạy thật: { pushed, skipped, failed, errors, boQuaDuoiSan, demBoQua, viDuBoQua, [chuaBietPhi] }
//   seBoQua / skipped = MỌI mã không ghi (giá đã bằng, chưa nối kho, không có giá bán lẻ, rào giá sàn);
//   boQuaDuoiSan = phần do rào giá sàn, chia nhóm ở demBoQua; viDuBoQua ≤ 20 { sku, gia, lyDo }.
// ═══════════════════════════════════════════════════════════════════════════════

import { getPlatformService } from '../services/platforms'
import { tinhGiaDeXuat, chanGiaDuoiSan, lyDoChuaBietPhi } from './giaShopee'
import { docMauPhiTheoNganh } from './shopeeTuQuan'
import { giaVonHangLoat } from './shopeeThaoTac'
import { docChinhSachPilot, thamSoTinh } from './shopeePilot'
import { docChinhSachTikTok } from './tiktokPilot'
import type { KetQuaDayTon } from './dayTonLenSan'

export interface ThamSoDayGia {
    dryRun?: boolean
    /** Chỉ đẩy đúng mấy listing này. Trống = cả kênh. */
    onlineProductIds?: string[]
    /** Bỏ qua bước "giá sàn đã bằng giá cần đẩy thì thôi" — KHÔNG bỏ qua rào giá sàn. */
    force?: boolean
    /** CHỈ cho bộ kiểm (scripts/check-pilot-tu-dong.ts, mục P) — route không bao giờ truyền: dịch vụ sàn giả thay
     *  getPlatformService (không làm mới token, không giãn nhịp 300ms). */
    giaLap?: { dichVu: any }
}

/** Nhóm lý do rào giá sàn chặn — giao diện đếm theo nhóm, ví dụ kèm nguyên văn lý do. */
export type NhomBoQuaGia = 'duoiSan' | 'thieuVon' | 'chuaBietPhi' | 'khac'

export async function dayGiaLenSan(prisma: any, channelId: string, ts: ThamSoDayGia = {}): Promise<KetQuaDayTon> {
    const channel = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
    if (!channel) return { http: 404, ok: false, loi: 'Kênh không tồn tại' }
    if (!['shopee', 'tiktok'].includes(channel.platform)) {
        return { http: 400, ok: false, loi: `Nền tảng ${channel.platform} chưa hỗ trợ đẩy giá` }
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

    /* Chính sách giá của Pilot CÙNG SÀN (đọc thẳng, không tạo bảng hộ) — chưa từng lưu ⇒ mặc định. Đọc HỎNG ⇒ dừng cả lượt,
     * không ghi giá nào: rơi về mặc định có thể LỎNG hơn biên chủ shop đã đặt. */
    let pol: Parameters<typeof thamSoTinh>[0]
    try {
        pol = channel.platform === 'tiktok' ? await docChinhSachTikTok(prisma) : await docChinhSachPilot(prisma)
    } catch (e: any) {
        return { http: 503, ok: false, loi: String(e?.message || e) }
    }

    const chayThu = ts.dryRun === true
    const force = ts.force === true

    const where: any = { channelId: channel.id }
    if (Array.isArray(ts.onlineProductIds) && ts.onlineProductIds.length > 0) where.id = { in: ts.onlineProductIds.map(String) }

    const onlineProducts: any[] = await prisma.onlineProduct.findMany({
        where,
        include: { localProduct: { select: { id: true, sku: true, sellingPrice: true } } },
    })

    // Phí theo ngành đọc MỘT lần cho cả lượt (mỗi listing chọn ngành của nó); giá vốn gom lô (≤ 4 truy vấn dù bao nhiêu listing).
    const bangPhi = await docMauPhiTheoNganh(prisma, channel)
    const von = await giaVonHangLoat(prisma, onlineProducts)

    let pushed = 0, skipped = 0, failed = 0
    const errors: string[] = []
    const boQua: { sku: string; gia: number; lyDo: string; nhom: NhomBoQuaGia }[] = []
    const keHoach: { p: any; targetPrice: number }[] = []

    for (const p of onlineProducts) {
        let local = p.localProduct
        if (!local && p.sku) {
            local = await prisma.product.findFirst({
                where: { sku: p.sku },
                select: { id: true, sku: true, sellingPrice: true },
            })
        }
        if (!local || !(local.sellingPrice > 0)) { skipped++; continue }

        const targetPrice = local.sellingPrice
        if (!force && p.price === targetPrice) { skipped++; continue }

        /* RÀO GIÁ SÀN — trước khi có bất kỳ lời gọi sàn nào. Thứ tự lý do theo tinhGiaDeXuat: thiếu giá vốn (việc của
         * từng mã) → chưa biết phí (việc của cả gian) → dưới giá sàn. */
        const giaVon = von.get(p.id)?.giaVon || 0
        const mp = bangPhi.chon(p.categoryId)
        const kq = tinhGiaDeXuat(thamSoTinh(pol, giaVon, mp))
        const chan = chanGiaDuoiSan(targetPrice, kq)
        if (chan) {
            skipped++
            const nhom: NhomBoQuaGia = !(giaVon > 0) ? 'thieuVon' : mp.chuaBiet ? 'chuaBietPhi' : kq.giaSan > 0 && targetPrice < kq.giaSan ? 'duoiSan' : 'khac'
            boQua.push({ sku: p.sku || local.sku || p.platformProductId, gia: targetPrice, lyDo: chan, nhom })
            continue
        }
        keHoach.push({ p, targetPrice })
    }

    const demBoQua: Record<NhomBoQuaGia, number> = { duoiSan: 0, thieuVon: 0, chuaBietPhi: 0, khac: 0 }
    for (const b of boQua) demBoQua[b.nhom]++
    // Cả gian chưa biết phí (không ngành nào đo được): mọi mã cùng MỘT lý do — nói một lần, giao diện khỏi lặp 20 dòng y hệt
    const chuaBietPhi = bangPhi.toanGian.chuaBiet && !bangPhi.theoNganh.size ? lyDoChuaBietPhi(bangPhi.toanGian.soDon, channel.name) : null
    const chung = {
        boQuaDuoiSan: boQua.length,
        demBoQua,
        viDuBoQua: boQua.slice(0, 20).map(({ sku, gia, lyDo }) => ({ sku, gia, lyDo })),
        ...(chuaBietPhi ? { chuaBietPhi } : {}),
    }

    if (chayThu) {
        // HẠ giá mạnh nhất lên đầu — giá lẻ POS thường thấp hơn giá sàn đang để; người bấm cần thấy trước mã nào sắp giảm nhiều
        const tyLe = (d: { giaCu: number; giaMoi: number }) => (d.giaCu > 0 ? d.giaMoi / d.giaCu : 1)
        const viDuDoi = keHoach.map(k => ({ sku: k.p.sku || k.p.platformProductId, giaCu: Number(k.p.price) || 0, giaMoi: k.targetPrice }))
            .sort((a, b) => tyLe(a) - tyLe(b)).slice(0, 20)
        return {
            http: 200, ok: true,
            data: {
                chayThu: true, seDay: keHoach.length, seBoQua: skipped, ...chung, viDuDoi,
                ghiChu: 'CHẠY THỬ — chưa gọi sàn, chưa ghi gì. Bỏ dryRun để chạy thật.',
            },
        }
    }

    // Token làm mới chỉ khi chạy thật (đệm 5 phút) — chạy thử đúng nghĩa "chưa gọi sàn, chưa ghi gì"
    const tokenExpiresAt = (channel as any).tokenExpiresAt
    if (!giaLap && keHoach.length && tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
        try {
            const tokens = await service.refreshAccessToken()
            service.credentials.accessToken = tokens.accessToken
            service.credentials.refreshToken = tokens.refreshToken
            await prisma.onlineChannel.update({
                where: { id: channel.id },
                data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
            })
        } catch (e: any) { console.warn('[push-price] Token refresh failed:', e.message) }
    }

    for (const { p, targetPrice } of keHoach) {
        try {
            if (channel.platform === 'shopee') {
                await service.updatePrice(p.platformProductId, targetPrice)
            } else {
                await service.updatePrice(p.platformProductId, targetPrice, undefined, p.sku || undefined)
            }
            await prisma.onlineProduct.update({
                where: { id: p.id },
                data: { price: targetPrice, syncedAt: new Date() },
            })
            pushed++
        } catch (e: any) {
            failed++
            errors.push(`${p.sku || p.platformProductId}: ${e.message}`)
            console.error(`[push-price] ${channel.name} ${p.platformProductId}:`, e.message)
        }

        // Giãn nhịp giữa hai lời gọi sàn để không chạm trần tần suất (sàn giả của bộ kiểm không có trần)
        if (!giaLap) await new Promise(r => setTimeout(r, 300))
    }

    await prisma.syncLog.create({
        data: {
            channelId: channel.id,
            action: 'push_price',
            status: failed > 0 ? 'partial' : 'success',
            details: `Pushed: ${pushed}, skipped: ${skipped}, failed: ${failed}`
                + (boQua.length ? ` | rào giá sàn bỏ qua ${boQua.length} mã (dưới sàn ${demBoQua.duoiSan}, thiếu giá vốn ${demBoQua.thieuVon}, chưa biết phí ${demBoQua.chuaBietPhi})` : '')
                + (errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''),
            ordersCount: pushed,
        },
    }).catch(() => { })

    return { http: 200, ok: true, data: { pushed, skipped, failed, errors, ...chung } }
}
