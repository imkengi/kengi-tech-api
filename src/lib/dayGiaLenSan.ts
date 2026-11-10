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
//  KHUYẾN MÃI TikTok (10/11/2026, lô 19 — cùng bản đọc với TikTok Pilot, lib/tiktokPilot.docKhuyenMaiGianTikTok):
//  giảm theo % tính trên GIÁ GỐC ⇒ đổi giá gốc là đổi luôn giá khuyến mãi (hạ có thể kéo giá khách trả xuống dưới
//  giá sàn); tăng ngay trước đợt giảm dính luật "tăng giá ảo". Nút này đẩy CẢ GIAN một lần bấm ⇒ mã nằm trong
//  chương trình ĐANG hoặc SẮP chạy: BỎ QUA (nhóm 'khuyenMai'), muốn đổi thì đổi từng mã (TikTok Pilot / Seller
//  Center — nơi người thấy lời nhắc của đúng mã đó). Chưa rõ (đọc hỏng, thiếu gói quyền 105005, chương trình toàn
//  gian) mà có mã sắp HẠ ⇒ vẫn đẩy (người bấm, như luật người của Pilot) kèm `canhBaoKhuyenMai` trong bản xem trước.
//  Chạy thử cũng ĐỌC khuyến mãi (chỉ đọc) — trừ khi token sắp hết hạn: chạy thử không làm mới token, nói rõ.
//
//  Kết quả (data):
//   - chạy thử: { chayThu, seDay, seBoQua, boQuaDuoiSan, demBoQua, viDuBoQua, viDuDoi, [chuaBietPhi], [canhBaoKhuyenMai], ghiChu }
//   - chạy thật: { pushed, skipped, failed, errors, boQuaDuoiSan, demBoQua, viDuBoQua, [chuaBietPhi], [canhBaoKhuyenMai] }
//   seBoQua / skipped = MỌI mã không ghi (giá đã bằng, chưa nối kho, không có giá bán lẻ, rào giá sàn, khuyến mãi);
//   boQuaDuoiSan = phần do rào giá sàn (KHÔNG gồm khuyến mãi — đếm riêng ở demBoQua.khuyenMai), chia nhóm ở demBoQua;
//   viDuBoQua ≤ 20 { sku, gia, lyDo } rải đều theo nhóm.
// ═══════════════════════════════════════════════════════════════════════════════

import { getPlatformService } from '../services/platforms'
import { tinhGiaDeXuat, chanGiaDuoiSan, lyDoChuaBietPhi } from './giaShopee'
import { docMauPhiTheoNganh } from './shopeeTuQuan'
import { giaVonHangLoat } from './shopeeThaoTac'
import { docChinhSachPilot, thamSoTinh } from './shopeePilot'
import { docChinhSachTikTok, docKhuyenMaiGianTikTok, lyDoKhuyenMaiChuaRo, type KmSanPham } from './tiktokPilot'
import type { KetQuaDayTon } from './dayTonLenSan'

export interface ThamSoDayGia {
    dryRun?: boolean
    /** Chỉ đẩy đúng mấy listing này. Trống = cả kênh. */
    onlineProductIds?: string[]
    /** Bỏ qua bước "giá sàn đã bằng giá cần đẩy thì thôi" — KHÔNG bỏ qua rào giá sàn. */
    force?: boolean
    /** (lô 19) id listing bản xem trước đã để yên vì khuyến mãi (data.maKhuyenMai của lượt chạy thử). Lượt thật đọc lại khuyến
     *  mãi; đọc lại HỎNG thì vẫn để yên các mã này — bản xem trước người bấm vừa duyệt không bị lượt thật lật ngược. */
    deYenKhuyenMai?: string[]
    /** CHỈ cho bộ kiểm (scripts/check-pilot-tu-dong.ts, mục P) — route không bao giờ truyền: dịch vụ sàn giả thay
     *  getPlatformService (không làm mới token, không giãn nhịp 300ms). */
    giaLap?: { dichVu: any }
}

/** Nhóm lý do rào chặn — giao diện đếm theo nhóm, ví dụ kèm nguyên văn lý do. 'khuyenMai' (lô 19): mã TikTok trong chương
 *  trình đang / sắp chạy — KHÔNG thuộc rào giá sàn (boQuaDuoiSan không đếm). */
export type NhomBoQuaGia = 'duoiSan' | 'thieuVon' | 'chuaBietPhi' | 'khac' | 'khuyenMai'

/** Lý do bỏ qua một mã TikTok trong chương trình khuyến mãi (nút đẩy cả gian — không có cửa "người duyệt mã này") */
const lyDoKhuyenMai = (ct: KmSanPham) => ct.dangChay
    ? `Đang trong ${ct.moTa} — giảm theo % tính trên giá gốc nên đổi giá gốc là đổi luôn giá khuyến mãi; để yên tới khi chương trình kết thúc.`
    : `Nằm trong ${ct.moTa} — tăng ngay trước đợt giảm dễ dính luật "tăng giá ảo" của TikTok, hạ là hạ luôn giá khuyến mãi; để yên. Muốn đổi thì đổi riêng mã này (TikTok Pilot / Seller Center).`

/** ≤ n ví dụ RẢI theo nhóm (lần lượt mỗi nhóm một mã, theo thứ tự gặp; trong nhóm giữ thứ tự listing) — 20 mã đầu cùng
 *  "dưới giá sàn" thì người bấm không thấy mã nào bị bỏ vì khuyến mãi. */
function viDuRaiDeu<T extends { nhom: string }>(ds: T[], n: number): T[] {
    const theoNhom = new Map<string, T[]>()
    for (const x of ds) { const g = theoNhom.get(x.nhom); if (g) g.push(x); else theoNhom.set(x.nhom, [x]) }
    const ra: T[] = []
    for (let i = 0; ra.length < Math.min(n, ds.length); i++)
        for (const g of theoNhom.values()) if (i < g.length && ra.length < n) ra.push(g[i]!)
    return ra
}

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
    const boQua: { id: string; sku: string; gia: number; lyDo: string; nhom: NhomBoQuaGia }[] = []
    let keHoach: { p: any; targetPrice: number; sku: string }[] = []

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
            boQua.push({ id: p.id, sku: p.sku || local.sku || p.platformProductId, gia: targetPrice, lyDo: chan, nhom })
            continue
        }
        keHoach.push({ p, targetPrice, sku: p.sku || local.sku || p.platformProductId })
    }

    /* Token làm mới chỉ khi chạy thật (đệm 5 phút) — chạy thử đúng nghĩa "chưa ghi gì", kể cả token. Làm mới TRƯỚC khi đọc
     * khuyến mãi: lượt thật đọc bằng đúng token sẽ ghi. */
    const tokenExpiresAt = (channel as any).tokenExpiresAt
    const tokenSapHet = !!tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000
    // sàn giả của bộ kiểm không làm mới token (vẫn đi đúng nhánh "chạy thử token sắp hết ⇒ chưa đọc khuyến mãi")
    if (!giaLap && !chayThu && tokenSapHet && keHoach.length) {
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

    /* KHUYẾN MÃI TikTok (10/11/2026, lô 19) — sau rào giá sàn, chỉ cho mã sắp ghi. Chạy thử mà token sắp hết ⇒ không đọc (không
     * làm mới token hộ), nói rõ. Dịch vụ không có API khuyến mãi (sàn giả của bộ kiểm cũ) ⇒ không soát, như trước lô 19. */
    let canhBaoKhuyenMai: string | null = null
    let docKhuyenMai = false
    let kmChuaRo: { lyDo: string; thieuGoi: boolean } | null = null
    const deYen = (lyDo: string, k: (typeof keHoach)[number]) => {
        skipped++
        boQua.push({ id: k.p.id, sku: k.sku, gia: k.targetPrice, lyDo, nhom: 'khuyenMai' })
    }
    if (channel.platform === 'tiktok' && keHoach.length) {
        if (chayThu && tokenSapHet) {
            canhBaoKhuyenMai = 'Token TikTok sắp hết hạn — chạy thử không làm mới token nên CHƯA đọc khuyến mãi của gian; lượt chạy thật làm mới token rồi đọc: mã đang / sắp khuyến mãi khi đó được để yên (số mã đổi có thể ít hơn bản xem trước).'
        } else {
            const km = await docKhuyenMaiGianTikTok(service)
            if (!(km.ok && km.khongSoat)) {
                docKhuyenMai = true
                const truoc = new Set((ts.deYenKhuyenMai || []).map(String))
                const conLai: typeof keHoach = []
                for (const k of keHoach) {
                    const ct = km.ok ? km.theoSanPham.get(String(k.p.platformProductId)) : undefined
                    if (ct) deYen(lyDoKhuyenMai(ct), k)
                    // đọc lại HỎNG: bản xem trước thấy mã này trong khuyến mãi ⇒ giữ đúng điều người bấm vừa xem
                    else if (!km.ok && truoc.has(String(k.p.id))) deYen('Bản xem trước thấy mã này trong chương trình khuyến mãi; lượt này đọc lại khuyến mãi HỎNG nên vẫn để yên.', k)
                    else conLai.push(k)
                }
                keHoach = conLai
                const lyDo = lyDoKhuyenMaiChuaRo(km)
                if (lyDo) kmChuaRo = { lyDo, thieuGoi: !km.ok && km.thieuGoi }
            }
        }
    }
    /** mã HẠ giá so với giá đang lưu — giá lưu 0 / rỗng (chưa biết) tính là có thể hạ */
    const laHa = (k: { p: any; targetPrice: number }) => { const cu = Number(k.p.price) || 0; return !(cu > 0) || k.targetPrice < cu }
    /** chưa biết chắc mã nào dính khuyến mãi + có mã hạ giá ⇒ nhắc (người bấm vẫn đẩy được — luật người của TikTok Pilot) */
    const cauChuaRo = (soHa: number, daDay: boolean) => !kmChuaRo || !(soHa > 0) ? null
        : `Chưa biết chắc mã nào đang / sắp khuyến mãi: ${kmChuaRo.lyDo}. ${soHa} mã ${daDay ? 'đã' : 'sắp'} HẠ giá — mã nào nằm trong chương trình giảm theo % thì giá khách trả giảm theo, có thể dưới giá sàn. ${daDay ? 'Xem lại chương trình trên TikTok Seller Center.' : 'Xem chương trình trên TikTok Seller Center trước khi đẩy.'}`
            // người bấm đang đứng ngay hộp «Kênh bán hàng» — nút «Cấp lại quyền» nằm trên dòng của gian
            + (kmChuaRo.thieuGoi ? ' Gói quyền do quản trị Kengi xin ở TikTok Shop Partner Center; được duyệt thì bấm «Cấp lại quyền» ở dòng của gian.' : '')
    if (chayThu && !canhBaoKhuyenMai) canhBaoKhuyenMai = cauChuaRo(keHoach.filter(laHa).length, false)

    const demBoQua: Record<NhomBoQuaGia, number> = { duoiSan: 0, thieuVon: 0, chuaBietPhi: 0, khac: 0, khuyenMai: 0 }
    for (const b of boQua) demBoQua[b.nhom]++
    // Cả gian chưa biết phí (không ngành nào đo được): mọi mã cùng MỘT lý do — nói một lần, giao diện khỏi lặp 20 dòng y hệt
    const chuaBietPhi = bangPhi.toanGian.chuaBiet && !bangPhi.theoNganh.size ? lyDoChuaBietPhi(bangPhi.toanGian.soDon, channel.name) : null
    const chung = {
        // rào GIÁ SÀN (nghĩa cũ, giao diện ghi "do giá sàn") — mã để yên vì khuyến mãi đếm riêng ở demBoQua.khuyenMai
        boQuaDuoiSan: boQua.length - demBoQua.khuyenMai,
        demBoQua,
        viDuBoQua: viDuRaiDeu(boQua, 20).map(({ sku, gia, lyDo }) => ({ sku, gia, lyDo })),
        ...(chuaBietPhi ? { chuaBietPhi } : {}),
    }

    if (chayThu) {
        // HẠ giá mạnh nhất lên đầu — giá lẻ POS thường thấp hơn giá sàn đang để; người bấm cần thấy trước mã nào sắp giảm nhiều
        const tyLe = (d: { giaCu: number; giaMoi: number }) => (d.giaCu > 0 ? d.giaMoi / d.giaCu : 1)
        const viDuDoi = keHoach.map(k => ({ sku: k.p.sku || k.p.platformProductId, giaCu: Number(k.p.price) || 0, giaMoi: k.targetPrice }))
            .sort((a, b) => tyLe(a) - tyLe(b)).slice(0, 20)
        // id listing để yên vì khuyến mãi — giao diện gửi lại khi bấm "Đẩy thật" (deYenKhuyenMai)
        const maKhuyenMai = boQua.filter(b => b.nhom === 'khuyenMai').map(b => b.id)
        return {
            http: 200, ok: true,
            data: {
                chayThu: true, seDay: keHoach.length, seBoQua: skipped, ...chung, viDuDoi,
                ...(canhBaoKhuyenMai ? { canhBaoKhuyenMai } : {}),
                ...(maKhuyenMai.length ? { maKhuyenMai } : {}),
                ghiChu: docKhuyenMai
                    ? 'CHẠY THỬ — chỉ ĐỌC khuyến mãi của gian trên TikTok, chưa ghi gì. Bỏ dryRun để chạy thật.'
                    : 'CHẠY THỬ — chưa gọi sàn, chưa ghi gì. Bỏ dryRun để chạy thật.',
            },
        }
    }

    let daHa = 0
    for (const k of keHoach) {
        const { p, targetPrice } = k
        const ha = laHa(k)   // trước khi ghi — ghi xong p.price có thể đã là giá mới
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
            if (ha) daHa++
        } catch (e: any) {
            failed++
            errors.push(`${p.sku || p.platformProductId}: ${e.message}`)
            console.error(`[push-price] ${channel.name} ${p.platformProductId}:`, e.message)
        }

        // Giãn nhịp giữa hai lời gọi sàn để không chạm trần tần suất (sàn giả của bộ kiểm không có trần)
        if (!giaLap) await new Promise(r => setTimeout(r, 300))
    }

    const canhBaoThat = cauChuaRo(daHa, true)
    await prisma.syncLog.create({
        data: {
            channelId: channel.id,
            action: 'push_price',
            status: failed > 0 ? 'partial' : 'success',
            details: `Pushed: ${pushed}, skipped: ${skipped}, failed: ${failed}`
                + (chung.boQuaDuoiSan ? ` | rào giá sàn bỏ qua ${chung.boQuaDuoiSan} mã (dưới sàn ${demBoQua.duoiSan}, thiếu giá vốn ${demBoQua.thieuVon}, chưa biết phí ${demBoQua.chuaBietPhi})` : '')
                + (demBoQua.khuyenMai ? ` | khuyến mãi TikTok: để yên ${demBoQua.khuyenMai} mã` : '')
                + (canhBaoThat && kmChuaRo ? ` | chưa rõ khuyến mãi (${kmChuaRo.lyDo.slice(0, 120)}), ${daHa} mã đã hạ giá` : '')
                + (errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''),
            ordersCount: pushed,
        },
    }).catch(() => { })

    return { http: 200, ok: true, data: { pushed, skipped, failed, errors, ...chung, ...(canhBaoThat ? { canhBaoKhuyenMai: canhBaoThat } : {}) } }
}
