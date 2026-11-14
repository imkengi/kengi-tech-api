// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — AI TỰ QUẢN MỘT GIAN SHOPEE (31/10/2026)
//
//  Chủ shop: "AI tự quản lý 1 trang Shopee riêng, tự đăng sản phẩm, tính toán mức
//  giá để đăng và bán hàng". Vòng làm việc của agent:
//    shopee_shop_info → shopee_sync_listings → shopee_listing_candidates
//    → shopee_suggest_price → shopee_category_suggest → shopee_category_attributes
//    → shopee_create_listing   (đăng)
//    shopee_review_listings → shopee_update_price / shopee_toggle_listing (chăm giá)
//  Đơn về, đẩy tồn, chat khách đã có đường riêng (autoSync / dayTonLenSan / chatbot).
//
//  RÀO AN TOÀN (agent chạy khi không ai xem):
//   - Mọi giá ghi lên Shopee qua chanGiaDuoiSan: dưới giá sàn (biên tối thiểu, mặc
//     định 5%, không bao giờ < 0) là TỪ CHỐI. Thiếu giá vốn là KHÔNG đăng.
//   - Chính sách Shopee Pilot của cửa hàng (biên tối thiểu, đóng gói, quảng cáo, hoa hồng
//     affiliate, thuế GTGT) là NỀN: tham số AI truyền vào chỉ được chặt hơn (01/11/2026).
//   - Phí sàn chưa đủ tin (phí khai / đo từ < 30 đơn / giá thấp hơn mọi đơn đã đo) ⇒ tool ghi TỪ CHỐI
//     đăng mới / HẠ giá / hiện lại, để chủ shop duyệt trên Shopee Pilot. TĂNG giá vẫn được (lãi mỗi
//     đơn tăng theo giá — không bao giờ lỗ thêm). Hiện lại sản phẩm đang ẩn cũng qua rào giá sàn.
//   - CHƯA BIẾT PHÍ sàn của gian (09/11/2026: chưa đủ đơn đối soát để đo, chưa khai phí — KHÔNG mượn số đo
//     gian khác) ⇒ không tool nào tính / ghi được giá nào, cả tăng lẫn hạ; tool đọc không đưa lãi / biên tính
//     theo số cấu hình 6% (số bịa) mà báo "chưa biết phí" kèm đường khai phí.
//   - Ba tool ghi ra Shopee nằm trong TOOL_NHAY_CAM — tác vụ tự động phải khai đích danh.
//   - Ba tool ghi đi qua CỬA của Shopee Pilot (09/11/2026, X-03/SP-02 — lib/shopeePilot doiGiaQuaPilot / anHienQuaPilot /
//     dangQuaPilot): Pilot Xem trước ⇒ chỉ lập nháp cho chủ shop duyệt (ẩn / hiện: từ chối); Tự động ⇒ kế hoạch + thucThi
//     (giá sống, khuyến mãi, biên độ, trần ghi ngày CHUNG, nghỉ 24 giờ/mã, sổ ShopeePilotWrite người 'ai:<nguồn>'). Ẩn hàng:
//     tối đa 5 mã / gian / ngày, hàng còn tồn + có đơn 14 ngày cần chủ shop duyệt. Trước đó tool gọi thẳng và đi vòng mọi rào đó.
//   - Đăng trùng: kiểm listing của gian (localProductId / SKU / ánh xạ SKU) trước khi
//     gọi add_item; danh mục cũ quá thì cảnh báo đồng bộ lại.
// ═══════════════════════════════════════════════════════════════════════════════

import { Tool, ToolCtx, ToolError, canhBaoCat } from '../lib/mcpTypes'
import { lyDoChanPilot, TIEN_ICH_SHOPEE_PILOT } from '../lib/tienIchCuaHang'
import { tinhGiaDeXuat, chanGiaDuoiSan, danhGiaGia, lyDoPhiChuaDuTin, lyDoChuaBietPhi, type ThamSoGia, type MauPhi } from '../lib/giaShopee'
import {
    chonKenhShopee, moDichVuShopee, docMauPhiTheoNganh, timHangKho, luuDanhMucSan, duongNganh,
} from '../lib/shopeeTuQuan'
import {
    num, chinhSachGia, gioiHanGia, giaVonHangLoat, soBan14Ngay, daBanCuaListing, timUngVien,
} from '../lib/shopeeThaoTac'
import { docChinhSachPilot, nenGia, khoSql, doiGiaQuaPilot, anHienQuaPilot, dangQuaPilot, TRAN_AN_AI_MOI_NGAY, type NgCanh } from '../lib/shopeePilot'
import { polCua, khoaListing, khoaHangKho, moTaLaiRieng, docDsLaiRieng } from '../lib/laiRiengPilot'
import { tomTatAnh } from '../lib/goiYAnhSanPham'

const NGAY = 86400_000

/* Chính sách Shopee Pilot của cửa hàng làm nền giá cho tool — tham số AI chỉ được chặt hơn. Lãi riêng theo nhóm / mã hàng
 * (12/11/2026): nền tính cho TỪNG mặt hàng qua polCua — nhóm đặt sàn 20% thì tool không được tính theo sàn chung 5%. */

/** Ngữ cảnh Shopee Pilot cho tool GHI (09/11/2026): cùng kho kế hoạch / sổ ghi / chính sách / chế độ với bảng điều khiển; người
 *  = 'ai:<nguồn>' để sổ ShopeePilotWrite và danh sách kế hoạch tách AI khỏi chủ shop; gian = gian AI chọn (tham số kenh). */
async function ngCanhPilot(ctx: ToolCtx, a: any): Promise<NgCanh> {
    const ch = await chonKenhShopee(ctx.prisma, a?.kenh)
    return {
        prisma: ctx.prisma, kho: ctx.khoPilot || khoSql(ctx.prisma), kenhId: ch.id,
        nguoi: `ai:${String(ctx.nguon || ctx.userName || 'không rõ nguồn').slice(0, 120)}`,
    }
}
const CUA_PILOT = 'Đi qua Shopee Pilot: Pilot đang XEM TRƯỚC thì chỉ lập NHÁP cho chủ shop duyệt ở Shopee Pilot (chưa ghi gì lên Shopee — đừng báo là đã làm); ' +
    'Pilot TỰ ĐỘNG thì ghi thật nhưng tính vào trần thao tác ghi / ngày của Pilot và được ghi vào Nhật ký Pilot.'

/** Hoa hồng affiliate đo từ từng đơn cho AI đọc — null = chưa đơn nào đọc được hoa hồng. */
const tomTatAffiliate = (m: MauPhi) => m.affiliate ? {
    phiDaTachRieng: m.affiliate.tachRieng,
    trungBinhPct: Math.round(m.affiliate.tyLeTB * 10000) / 100,
    caoNhatMotDonPct: Math.round(m.affiliate.tyLeMax * 10000) / 100,
    soDonBiet: m.affiliate.soDonBiet,
    soDonQuaAffiliate: m.affiliate.soDonCo,
} : null

/** Mô hình phí cho AI đọc — kèm PHẠM VI: ngành riêng / cả gian thay ngành chưa đủ đơn / phí KHAI / CHƯA BIẾT PHÍ.
 *  09/11/2026 (chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): không còn "mượn số đo gian khác". Chưa biết phí ⇒
 *  tyLePct null — số cấu hình 6% mặc định không phải phí, đừng để AI tự tính giá theo nó. */
const tomTatPhi = (m: MauPhi) => ({
    tyLePct: m.chuaBiet ? null : Math.round(m.tyLe * 10000) / 100, coDinhMoiDon: m.coDinh, nguon: m.nguon, soDon: m.soDon,
    phamVi: m.nganh ? `ngành ${m.nganh}`
        : m.chuaBiet ? 'CHƯA BIẾT PHÍ — gian chưa đủ đơn đối soát để đo, chưa khai phí: không tính / ghi được giá nào'
            : m.khai ? 'phí KHAI của gian (chưa đủ đơn đối soát để đo) — chỉ người duyệt, máy không tự đăng / hạ giá'
                : m.thayNganh ? `cả gian (ngành ${m.thayNganh} chưa đủ đơn)` : m.chuaRoNganh ? 'cả gian (chưa rõ ngành)' : 'cả gian',
    ghiChu: m.ghiChu, hoaHongAffiliate: tomTatAffiliate(m),
})

/** Tham số chính sách giá dùng chung cho mọi tool có tính giá. */
const THAM_SO_GIA = {
    bien_loi_nhuan: { type: 'number', description: 'Biên lãi MỤC TIÊU trên giá bán, %. Mặc định theo chính sách Shopee Pilot của cửa hàng (chưa đặt: 15). Lấy theo chỉ thị chủ shop nếu có.' },
    bien_toi_thieu: { type: 'number', description: 'Biên lãi TỐI THIỂU, % (giá sàn). Mặc định theo chính sách Shopee Pilot (chưa đặt: 5). Chỉ NÂNG được — truyền thấp hơn chính sách thì vẫn dùng mức chính sách. Không bao giờ bán lỗ.' },
    phi_dong_goi: { type: 'number', description: 'Chi phí đóng gói / vật tư mỗi đơn, VND. Mặc định theo chính sách Shopee Pilot; chỉ nâng được.' },
    phi_quang_cao: { type: 'number', description: '% giá bán dành cho quảng cáo / voucher shop. Mặc định theo chính sách Shopee Pilot; chỉ nâng được.' },
    hoa_hong_affiliate: { type: 'number', description: '% hoa hồng affiliate — giá sàn tính như MỌI đơn đều qua affiliate. Mặc định theo chính sách Shopee Pilot; chỉ nâng được. Đã có đơn trả hoa hồng cao hơn thì giá sàn tự dùng mức đo được.' },
    lam_tron: { type: 'number', description: 'Làm tròn LÊN giá đề xuất theo bước này (VND). Mặc định theo chính sách Shopee Pilot (chưa đặt: 1000).' },
} as const

const CAC_TOOL: Tool[] = [
    {
        name: 'shopee_shop_info',
        description: 'GỌI ĐẦU TIÊN khi quản gian Shopee: các gian Shopee của store, gian đang chọn (token, số listing, lần đồng bộ danh mục cuối), MÔ HÌNH PHÍ SÀN đo từ đơn đã đối soát (dùng để tính giá), kênh vận chuyển đang bật và giới hạn đăng của gian (độ dài tên/mô tả, số ảnh, khoảng giá).',
        inputSchema: {
            type: 'object',
            properties: {
                kenh: { type: 'string', description: 'Tên / id / shop_id của gian Shopee. Bỏ trống nếu store chỉ có 1 gian.' },
            },
        },
        run: async (a, { prisma }) => {
            const ds: any[] = await prisma.onlineChannel.findMany({
                where: { platform: 'shopee' }, orderBy: { createdAt: 'asc' },
                select: { id: true, name: true, shopId: true, status: true, tokenExpiresAt: true, accessToken: true },
            })
            const cacGian = ds.map(c => ({ id: c.id, ten: c.name, shopId: c.shopId, trangThai: c.status, daUyQuyen: !!c.accessToken }))
            if (!a?.kenh && ds.length > 1) {
                return { cacGian, ghiChu: `Store có ${ds.length} gian Shopee — gọi lại kèm kenh để xem chi tiết một gian.` }
            }
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const svc = await moDichVuShopee(prisma, ch)
            const [soListing, moiNhat, bang] = await Promise.all([
                prisma.onlineProduct.count({ where: { channelId: ch.id } }),
                prisma.onlineProduct.findFirst({ where: { channelId: ch.id }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
                docMauPhiTheoNganh(prisma, ch),
            ])
            const mauPhi = bang.toanGian
            let vanChuyen: any = null, gioiHan: any = null
            try {
                vanChuyen = (await svc.getLogisticsChannels())
                    .filter((c: any) => c.enabled !== false)
                    .map((c: any) => ({
                        id: c.logistics_channel_id, ten: c.logistics_channel_name, cod: !!c.cod_enabled,
                        kieuPhi: c.fee_type, kenhGop: Number(c.mask_channel_id) || 0,
                        canToiDaKg: c.weight_limit?.item_max_weight,
                    }))
            } catch (e: any) { vanChuyen = { loi: String(e?.message || e).slice(0, 300) } }
            try {
                const r = await svc.getItemLimit()
                gioiHan = {
                    gia: r.price_limit, tenSanPham: r.item_name_length_limit, moTa: r.item_description_length_limit,
                    soAnh: r.item_image_count_limit, soSanPhamToiDa: r.item_count_limit,
                }
            } catch (e: any) { gioiHan = { loi: String(e?.message || e).slice(0, 300) } }
            const tuoiDanhMuc = moiNhat?.syncedAt ? Math.floor((Date.now() - new Date(moiNhat.syncedAt).getTime()) / NGAY) : null
            return {
                gian: { id: ch.id, ten: ch.name, shopId: ch.shopId, link: `https://shopee.vn/shop/${ch.shopId}`, tokenHetHan: ch.tokenExpiresAt },
                listing: { soDong: soListing, dongBoCuoi: moiNhat?.syncedAt || null },
                ...(soListing === 0 || tuoiDanhMuc === null || tuoiDanhMuc > 2
                    ? { canhBaoDanhMuc: 'Danh mục listing của gian chưa đồng bộ gần đây — gọi shopee_sync_listings TRƯỚC khi đăng, nếu không có thể đăng TRÙNG sản phẩm đã có.' }
                    : {}),
                mauPhi: tomTatPhi(mauPhi),
                ...(mauPhi.chuaBiet ? { canhBaoPhi: lyDoChuaBietPhi(mauPhi.soDon, ch.name) } : {}),
                // mỗi ngành Shopee thu một % khác — tool tính giá tự dùng phí ĐÚNG ngành của sản phẩm
                phiTheoNganh: [...bang.theoNganh.values()].sort((x, y) => y.soDon - x.soDon).slice(0, 20).map(m => ({
                    nganh: m.nganh, tenNganh: bang.tenNganh.get(m.nganh!) || null,
                    tyLePct: Math.round(m.tyLe * 10000) / 100, coDinhMoiDon: m.coDinh, soDon: m.soDon,
                })),
                vanChuyen,
                gioiHanDang: gioiHan,
                cacGian,
            }
        },
    },
    {
        name: 'shopee_sync_listings',
        description: 'Kéo lại toàn bộ sản phẩm ĐANG BÁN của gian Shopee về hệ thống (giá, tồn, SKU) — cùng việc với nút Đồng bộ trên web. Gọi trước khi tìm hàng để đăng (tránh đăng trùng) và trước khi soát giá. Chỉ ghi vào dữ liệu nội bộ, không đổi gì trên Shopee.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: { kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' } },
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const svc = await moDichVuShopee(prisma, ch)
            const { products, canhBao } = await svc.fetchProducts()
            const n = await luuDanhMucSan(prisma, ch, products)
            return {
                gian: ch.name, daDongBo: n, ghiChu: 'Chỉ kéo sản phẩm trạng thái NORMAL (đang bán); sản phẩm đã ẩn không có trong danh sách.',
                // mã chưa đọc được tồn giữ số cũ — AI phải thấy để không coi đó là số mới
                ...(canhBao?.length ? { canhBao } : {}),
            }
        },
    },
    {
        name: 'shopee_listing_candidates',
        description: 'Hàng trong kho CHƯA có trên gian Shopee và còn tồn — ứng viên để đăng. Mỗi dòng kèm giá vốn, giá bán lẻ, tồn bán được, số ảnh, độ dài mô tả và danh sách THIẾU (giá vốn / ảnh / mô tả) — thiếu thì không đăng được.',
        inputSchema: {
            type: 'object',
            properties: {
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                query: { type: 'string', description: 'Lọc theo tên / SKU (tuỳ chọn)' },
                nhom_hang: { type: 'string', description: 'Lọc theo tên nhóm hàng trong kho (tuỳ chọn)' },
                chi_du_dieu_kien: { type: 'boolean', description: 'true = chỉ trả hàng đủ giá vốn + ảnh + mô tả. Mặc định false.' },
                limit: { type: 'number', description: 'Mặc định 20, tối đa 50' },
            },
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const kq = await timUngVien(prisma, ch.id, {
                query: a?.query, nhomHang: a?.nhom_hang, chiDuDieuKien: a?.chi_du_dieu_kien === true,
                lim: Math.min(Math.max(num(a?.limit, 20), 1), 50),
            })
            return {
                ...(kq.chamTran ? canhBaoCat(kq.soQuet, kq.soQuet, 'mặt hàng kho (đã quét)') : {}),
                gian: ch.name, soListingDaCo: kq.soListingDaCo,
                ...(kq.soListingDaCo === 0 ? { canhBaoDanhMuc: 'Gian chưa có listing nào trong hệ thống — nếu gian đã có sản phẩm trên Shopee, gọi shopee_sync_listings trước để tránh đăng trùng.' } : {}),
                // ảnh cần NGƯỜI chụp (12/11/2026): AI không tự tạo ảnh — báo chủ shop / nhân viên chụp theo danh sách, tải ở trang Thông tin sản phẩm
                ungVien: kq.ungVien.map(({ moTa, anhDau, ...r }) => {
                    const g = tomTatAnh({ ten: r.ten, nhomHang: r.nhomHang, nhomCha: r.nhomCha, soAnh: r.soAnh })
                    return g.muc === 'du' ? r : { ...r, anhCanChup: { muc: g.muc, canThem: g.canThem, batBuoc: g.batBuoc } }
                }),
                ghiChuAnh: 'anhCanChup = ảnh NGƯỜI cần chụp trước khi đăng (không tạo ảnh bằng AI); ảnh tải lên ở kengi.vn → Thông tin sản phẩm. Trang đó hiện đủ danh sách cách chụp cho từng mặt hàng.',
            }
        },
    },
    {
        name: 'shopee_suggest_price',
        description: 'TÍNH GIÁ ĐĂNG Shopee cho một mặt hàng: giá đề xuất (đạt biên lãi mục tiêu sau phí sàn thật của gian), GIÁ SÀN (biên tối thiểu — tool ghi giá sẽ từ chối dưới mức này), giá hoà vốn, lãi dự kiến; kèm giá bán lẻ trong kho và giá đang bán ở các gian/sàn khác để đối chiếu. Truyền gia_thu để xem lãi của một mức giá cụ thể. canhBaoTuDong có nội dung = phí sàn chưa đủ tin: tool ghi sẽ TỪ CHỐI đăng mới / HẠ giá xuống giá đó (tăng giá vẫn được) — báo chủ shop duyệt trên Shopee Pilot.',
        inputSchema: {
            type: 'object',
            properties: {
                sku: { type: 'string', description: 'SKU hàng trong kho' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                gia_thu: { type: 'number', description: 'Một mức giá muốn thử (VND) — trả lãi/biên của đúng mức này' },
                category_id: { type: 'number', description: 'Ngành Shopee (nếu đã biết) để áp giới hạn giá của ngành' },
                ...THAM_SO_GIA,
            },
            required: ['sku'],
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const p = await timHangKho(prisma, a.sku)
            const polH = polCua(await docChinhSachPilot(prisma), khoaHangKho(p, a.sku))
            const cs = chinhSachGia(a, nenGia(polH))
            const khac: any[] = await prisma.onlineProduct.findMany({
                where: { OR: [{ localProductId: p.id }, { sku: { equals: p.sku, mode: 'insensitive' } }] },
                select: { platform: true, price: true, status: true, channel: { select: { name: true } }, channelId: true, categoryId: true },
                take: 20,
            })
            // phí ĐÚNG ngành: ngành truyền vào, không có thì ngành của listing đang bán trên chính gian này
            const nganh = a?.category_id || khac.find(k => k.channelId === ch.id && k.categoryId)?.categoryId || null
            const mauPhi = (await docMauPhiTheoNganh(prisma, ch)).chon(nganh)
            let gh: { min?: number; max?: number } = {}
            if (a?.category_id) gh = await gioiHanGia(await moDichVuShopee(prisma, ch), num(a.category_id, 0))
            const ts: ThamSoGia = { giaVon: Number(p.costPrice) || 0, phi: mauPhi, ...cs, giaShopeeMin: gh.min, giaShopeeMax: gh.max }
            const kq = tinhGiaDeXuat(ts)
            const tuDong = kq.hopLe ? lyDoPhiChuaDuTin(kq.giaDeXuat, mauPhi, cs.bienToiThieuPct) : null
            return {
                sanPham: { sku: p.sku, ten: p.name, giaVon: p.costPrice, giaBanLe: p.sellingPrice },
                ...kq,
                ...(tuDong ? { canhBaoTuDong: tuDong } : {}),
                // chưa biết phí: lãi của mức giá thử tính theo 6% cấu hình là số bịa — chỉ nói bị chặn vì sao (09/11/2026)
                giaThu: a?.gia_thu ? (mauPhi.chuaBiet ? { gia: num(a.gia_thu, 0), biChan: chanGiaDuoiSan(num(a.gia_thu, 0), kq) } : {
                    ...danhGiaGia(num(a.gia_thu, 0), ts), quaAffiliate: danhGiaGia(num(a.gia_thu, 0), ts, true),
                    biChan: chanGiaDuoiSan(num(a.gia_thu, 0), kq) || lyDoPhiChuaDuTin(num(a.gia_thu, 0), mauPhi, cs.bienToiThieuPct),
                }) : undefined,
                chinhSach: cs,
                ...(polH.laiRieng ? { laiRieng: `Áp lãi riêng ${moTaLaiRieng(polH.laiRieng)} (chủ shop khai ở Shopee Pilot) thay mức chung` } : {}),
                mauPhi: tomTatPhi(mauPhi),
                giaDangBanNoiKhac: khac.map(k => ({ gian: k.channel?.name, san: k.platform, gia: k.price, trangThai: k.status, laGianNay: k.channelId === ch.id })),
                ghiChu: 'Lãi tính cho đơn 1 sản phẩm (phí cố định/đơn gánh trọn) — đơn nhiều món lãi cao hơn. Không gồm phí vận chuyển người mua trả.',
            }
        },
    },
    {
        name: 'shopee_category_suggest',
        description: 'Tìm NGÀNH HÀNG Shopee (category_id lá) cho một sản phẩm: Shopee gợi ý theo tên, và/hoặc tìm trong cây ngành theo từ khoá. Trả đường ngành đầy đủ để chọn đúng.',
        inputSchema: {
            type: 'object',
            properties: {
                ten: { type: 'string', description: 'Tên sản phẩm (để Shopee gợi ý ngành)' },
                tu_khoa: { type: 'string', description: 'Từ khoá tìm trong cây ngành, vd "ổ cắm" (tuỳ chọn)' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
            },
        },
        run: async (a, { prisma }) => {
            if (!a?.ten && !a?.tu_khoa) throw new ToolError('Truyền ten hoặc tu_khoa')
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const svc = await moDichVuShopee(prisma, ch)
            const cay = await svc.getCategories('vi')
            const la = new Map(cay.map(c => [c.id, c]))
            let goiY: any[] = []
            let loiGoiY: string | undefined
            if (a?.ten) {
                try {
                    goiY = (await svc.categoryRecommend(String(a.ten))).map(id => ({
                        categoryId: id, duong: duongNganh(cay, id), laNganhLa: la.has(id) ? !la.get(id)!.coCon : null,
                    }))
                } catch (e: any) { loiGoiY = String(e?.message || e).slice(0, 300) }
            }
            let timThay: any[] = []
            if (a?.tu_khoa) {
                const tk = String(a.tu_khoa).toLowerCase()
                timThay = cay.filter(c => !c.coCon)
                    .map(c => ({ categoryId: c.id, duong: duongNganh(cay, c.id) }))
                    .filter(c => c.duong.toLowerCase().includes(tk))
                    .slice(0, 15)
            }
            return {
                goiYCuaShopee: goiY, ...(loiGoiY ? { loiGoiY } : {}),
                timTrongCayNganh: timThay,
                ghiChu: 'add_item chỉ nhận ngành LÁ (không còn ngành con). Chọn xong gọi shopee_category_attributes để lấy thuộc tính bắt buộc.',
            }
        },
    },
    {
        name: 'shopee_category_attributes',
        description: 'Thuộc tính của một ngành Shopee (thuộc tính BẮT BUỘC kèm danh sách giá trị có sẵn), thương hiệu (ngành có bắt buộc không, tìm brand_id theo tên) và giới hạn giá/tên/mô tả của ngành. Gọi trước shopee_create_listing.',
        inputSchema: {
            type: 'object',
            properties: {
                category_id: { type: 'number', description: 'Ngành lá từ shopee_category_suggest' },
                tim_thuong_hieu: { type: 'string', description: 'Tên thương hiệu cần tìm brand_id (tuỳ chọn)' },
                day_du: { type: 'boolean', description: 'true = trả cả giá trị của thuộc tính KHÔNG bắt buộc. Mặc định false.' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
            },
            required: ['category_id'],
        },
        run: async (a, { prisma }) => {
            const categoryId = num(a?.category_id, 0)
            if (!(categoryId > 0)) throw new ToolError('category_id không hợp lệ')
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const svc = await moDichVuShopee(prisma, ch)
            const tt = await svc.getCategoryAttributes(categoryId, 'vi')
            const batBuoc = tt.filter(t => t.batBuoc)
            const khong = tt.filter(t => !t.batBuoc)
            let thuongHieu: any
            try { thuongHieu = await svc.getBrandList(categoryId, a?.tim_thuong_hieu) }
            catch (e: any) { thuongHieu = { loi: String(e?.message || e).slice(0, 300) } }
            const gh = await gioiHanGia(svc, categoryId)
            return {
                categoryId,
                thuocTinhBatBuoc: batBuoc,
                thuocTinhTuyChon: a?.day_du ? khong : khong.map(t => ({ attributeId: t.attributeId, ten: t.ten, kieuNhap: t.kieuNhap, soGiaTri: t.soGiaTri })),
                thuongHieu,
                gioiHan: gh.raw ? { gia: gh.raw.price_limit, tenSanPham: gh.raw.item_name_length_limit, moTa: gh.raw.item_description_length_limit, soAnh: gh.raw.item_image_count_limit } : null,
                cachDien: 'Truyền vào shopee_create_listing.thuoc_tinh: chọn giá trị có sẵn thì {attribute_id, value_id}; kiểu go_tu_do / *_hoac_go thì {attribute_id, gia_tri, don_vi?}. ' +
                    'Giá trị PHẢI đúng với sản phẩm thật (lấy từ tên, mô tả, chỉ thị chủ shop) — không chắc thì đừng khai thuộc tính tuỳ chọn. ' +
                    'Ngành không bắt buộc thương hiệu thì bỏ trống brand_id (đăng "No brand").',
            }
        },
    },
    {
        name: 'shopee_create_listing',
        description: 'ĐĂNG SẢN PHẨM MỚI lên gian Shopee từ một mặt hàng trong kho: tự nạp ảnh sản phẩm, khai tồn bán được, SKU kho (đơn về tự khớp kho), kênh vận chuyển đang bật. ' +
            'Bỏ trống gia = dùng giá đề xuất; giá dưới GIÁ SÀN bị từ chối. Hàng thiếu giá vốn / ảnh / hết hàng / đã có trên gian bị từ chối. ' +
            'can_nang_gram BẮT BUỘC và phải là cân nặng thật (đã đóng gói) — không biết thì KHÔNG đăng, ghi vào báo cáo. chay_thu=true để xem trước thân yêu cầu mà không đăng. ' +
            `${CUA_PILOT} Phí sàn chưa đủ tin thì không tự đăng — để nháp chờ chủ shop duyệt.`,
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                sku: { type: 'string', description: 'SKU hàng trong kho' },
                category_id: { type: 'number', description: 'Ngành LÁ từ shopee_category_suggest' },
                can_nang_gram: { type: 'number', description: 'Cân nặng đã đóng gói (gram) — số thật, không đoán' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                gia: { type: 'number', description: 'Giá đăng (VND). Bỏ trống = giá đề xuất theo biên mục tiêu' },
                ten: { type: 'string', description: 'Tên hiển thị trên Shopee (mặc định tên trong kho). Viết rõ loại hàng + đặc điểm thật, không nhồi từ khoá' },
                mo_ta: { type: 'string', description: 'Mô tả (mặc định mô tả trong kho). Chỉ viết từ thông tin THẬT của sản phẩm — không bịa thông số, bảo hành, xuất xứ' },
                thuoc_tinh: {
                    type: 'array',
                    description: 'Thuộc tính ngành (xem shopee_category_attributes)',
                    items: {
                        type: 'object',
                        properties: {
                            attribute_id: { type: 'number' },
                            value_id: { type: 'number', description: 'Giá trị có sẵn' },
                            gia_tri: { type: 'string', description: 'Giá trị gõ tay (khi không có value_id)' },
                            don_vi: { type: 'string' },
                        },
                        required: ['attribute_id'],
                    },
                },
                brand_id: { type: 'number', description: 'brand_id từ shopee_category_attributes; bỏ trống = No brand' },
                ten_thuong_hieu: { type: 'string', description: 'Tên thương hiệu đi kèm brand_id' },
                dai_cm: { type: 'number' }, rong_cm: { type: 'number' }, cao_cm: { type: 'number' },
                kenh_van_chuyen: { type: 'array', items: { type: 'number' }, description: 'logistics_channel_id muốn bật (mặc định: mọi kênh phù hợp đang bật)' },
                so_luong_dang: { type: 'number', description: 'Giới hạn số tồn khai lên (mặc định = tồn bán được)' },
                an_sau_khi_dang: { type: 'boolean', description: 'true = đăng ở trạng thái ẨN để chủ shop duyệt rồi mới hiện' },
                chay_thu: { type: 'boolean', description: 'true = chỉ dựng và trả thân yêu cầu + phân tích giá, KHÔNG nạp ảnh, KHÔNG đăng' },
                ...THAM_SO_GIA,
            },
            required: ['sku', 'category_id', 'can_nang_gram'],
        },
        // Cửa Shopee Pilot (09/11/2026): Xem trước ⇒ nháp; Tự động ⇒ kế hoạch + thucThi như chu kỳ tự đăng — lib/shopeePilot.dangQuaPilot
        run: async (a, ctx) => dangQuaPilot(await ngCanhPilot(ctx, a), a),
    },
    {
        name: 'shopee_review_listings',
        description: 'SOÁT GIÁ các sản phẩm đang bán trên gian: giá hiện tại vs giá vốn → lãi/biên mỗi đơn, cờ DƯỚI GIÁ SÀN / dưới biên mục tiêu, giá đề xuất, số bán 14 ngày qua và tồn. Dùng để quyết tăng/giảm giá hoặc ẩn sản phẩm.',
        inputSchema: {
            type: 'object',
            properties: {
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                chi_van_de: { type: 'boolean', description: 'true = chỉ trả sản phẩm có vấn đề (dưới sàn, dưới mục tiêu, thiếu giá vốn, không bán được). Mặc định true.' },
                limit: { type: 'number', description: 'Mặc định 30, tối đa 100' },
                ...THAM_SO_GIA,
            },
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const lim = Math.min(Math.max(num(a?.limit, 30), 1), 100)
            const chiVanDe = a?.chi_van_de !== false
            const pol = await docChinhSachPilot(prisma)
            const cs = chinhSachGia(a, nenGia(pol))   // mức chung — từng listing tính lại theo lãi riêng của nó (csH)
            const bang = await docMauPhiTheoNganh(prisma, ch)   // từng listing soát theo phí NGÀNH của nó
            const mauPhi = bang.toanGian
            const TRAN = 300
            const ds: any[] = await prisma.onlineProduct.findMany({
                where: { channelId: ch.id, status: 'NORMAL' },
                orderBy: { updatedAt: 'desc' },
                take: TRAN,
            })
            // đọc hỏng ⇒ null: daBan14 để trống, KHÔNG gắn "14 ngày không bán được" cho AI hạ giá theo (TT-18, 10/11/2026)
            const daBan = await soBan14Ngay(prisma, ch.id, { theoMaSan: true }).catch((e: any) => {
                console.error('[mcp shopee] đọc số bán 14 ngày hỏng:', e?.message || e)
                return null
            })

            const von = await giaVonHangLoat(prisma, ds)
            const ra: any[] = []
            let duoiSan = 0, thieuVon = 0, chuaBietPhi = 0
            for (const l of ds) {
                const daBan14 = daBan ? daBanCuaListing(daBan, l) : null
                if (!(l.price > 0)) {
                    if (!chiVanDe && ra.length < lim) ra.push({ itemId: l.platformProductId, sku: l.sku, ten: l.name, ghiChu: 'Có phân loại / chưa đọc được giá — soát ở trang Shopee' })
                    continue
                }
                const v = von.get(l.id)
                if (!v || !(v.giaVon > 0)) {
                    thieuVon++
                    if (ra.length < lim) ra.push({ itemId: l.platformProductId, sku: l.sku, ten: l.name, gia: l.price, tonSan: l.stock, daBan14, vanDe: ['thiếu giá vốn — không biết lãi/lỗ'] })
                    continue
                }
                const mp = bang.chon(l.categoryId)
                if (mp.chuaBiet) {
                    // chưa biết phí sàn: lãi / biên / giá sàn tính theo 6% cấu hình là số bịa — không đưa cho AI (09/11/2026)
                    chuaBietPhi++
                    if (ra.length < lim) ra.push({ itemId: l.platformProductId, sku: l.sku, ten: l.name, gia: l.price, tonSan: l.stock, daBan14, giaVon: Math.round(v.giaVon), vanDe: ['CHƯA BIẾT PHÍ SÀN — không tính được lãi / giá sàn, không đổi giá được'] })
                    continue
                }
                const polH = polCua(pol, khoaListing(l, v))
                const csH = polH.laiRieng ? chinhSachGia(a, nenGia(polH)) : cs
                const ts: ThamSoGia = { giaVon: v.giaVon, phi: mp, ...csH }
                const kq = tinhGiaDeXuat(ts)
                const hien = danhGiaGia(l.price, ts)
                const vanDe: string[] = []
                if (kq.giaSan > 0 && l.price < kq.giaSan) { vanDe.push('DƯỚI GIÁ SÀN'); duoiSan++ }
                else if (hien.bienPct < csH.bienLoiNhuanPct) vanDe.push('dưới biên mục tiêu')
                if (daBan14 === 0 && l.stock > 0) vanDe.push('14 ngày không bán được')
                if ((chiVanDe && !vanDe.length) || ra.length >= lim) continue
                ra.push({
                    itemId: l.platformProductId, sku: l.sku, ten: l.name, gia: l.price, tonSan: l.stock, daBan14,
                    giaVon: Math.round(v.giaVon), laiMoiDon: hien.loiNhuan, bienPct: hien.bienPct,
                    giaSan: kq.giaSan, giaDeXuat: kq.hopLe ? kq.giaDeXuat : null, vanDe,
                    phiSanPct: Math.round(mp.tyLe * 10000) / 100, ...(mp.nganh ? { nganh: mp.nganh } : {}),
                    ...(polH.laiRieng ? { laiRieng: moTaLaiRieng(polH.laiRieng) } : {}),
                })
            }
            return {
                ...canhBaoCat(ds.length, TRAN, 'listing'),
                gian: ch.name, soListingDangBan: ds.length, duoiGiaSan: duoiSan, thieuGiaVon: thieuVon,
                ...(chuaBietPhi ? { chuaBietPhi, canhBaoPhi: lyDoChuaBietPhi(mauPhi.soDon, ch.name) } : {}),
                ...(!daBan ? { canhBaoDaBan: 'KHÔNG đọc được số đã bán 14 ngày (lỗi đọc dữ liệu) — daBan14 để trống; đừng coi là "không bán được", đừng hạ giá theo lý do bán chậm.' } : {}),
                ...(ra.length >= lim ? { ghiChuDanhSach: `Chỉ liệt kê ${lim} dòng đầu; các con số duoiGiaSan / thieuGiaVon${chuaBietPhi ? ' / chuaBietPhi' : ''} tính trên toàn bộ ${ds.length} listing đã đọc.` } : {}),
                mauPhi: mauPhi.ghiChu, chinhSach: cs,
                ...(pol.marginRules?.length ? { laiRieng: `Chủ shop khai lãi riêng theo nhóm / mã: ${docDsLaiRieng(pol.marginRules)} — giá sàn, giá đề xuất, "dưới biên mục tiêu" của các dòng đó đã tính theo quy tắc riêng (dòng có trường laiRieng), không theo chinhSach chung.` } : {}),
                ghiChu: 'Số bán 14 ngày đếm từ đơn còn trong hệ thống (đơn hoàn tất cũ bị dọn sau ~18 ngày). Giảm giá chỉ khi còn trên giá sàn; tăng giá hàng bán chạy dưới mục tiêu trước.',
                sanPham: ra,
            }
        },
    },
    {
        name: 'shopee_update_price',
        description: 'ĐỔI GIÁ một sản phẩm đang bán trên gian Shopee (theo item_id hoặc sku). Giá mới dưới GIÁ SÀN (biên tối thiểu sau phí sàn) hoặc sản phẩm thiếu giá vốn sẽ bị TỪ CHỐI. Hàng có phân loại không đổi được (sửa giá từng phân loại trên Shopee). Phí sàn của gian chưa đủ tin (phí khai chưa đo, đo từ dưới 30 đơn đối soát, hoặc giá thấp hơn mọi đơn đã đo) thì chỉ TĂNG giá được, HẠ giá thành nháp chờ chủ shop duyệt trên Shopee Pilot. Gian CHƯA BIẾT PHÍ (chưa đủ đơn để đo, chưa khai phí) thì không giá nào ghi được, cả tăng lẫn hạ — báo chủ shop khai phí sàn của gian ở Kênh bán online. ' +
            `${CUA_PILOT} Rào của Pilot: mỗi lần đổi tối đa X% so với giá GỐC đang để trên Shopee (vượt thì bị từ chối kèm khoảng được phép — chia nhiều bước), mỗi mã đổi tối đa 1 lần / 24 giờ (trừ mã đang dưới giá sàn được nâng lên), mã đang / sắp chạy khuyến mãi không đổi.`,
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                gia_moi: { type: 'number', description: 'Giá mới (VND)' },
                item_id: { type: 'string', description: 'item_id Shopee (từ shopee_review_listings)' },
                sku: { type: 'string', description: 'SKU (khi không có item_id)' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                ly_do: { type: 'string', description: 'Lý do đổi giá (ghi vào nhật ký)' },
                bien_toi_thieu: THAM_SO_GIA.bien_toi_thieu,
                phi_dong_goi: THAM_SO_GIA.phi_dong_goi,
                phi_quang_cao: THAM_SO_GIA.phi_quang_cao,
                hoa_hong_affiliate: THAM_SO_GIA.hoa_hong_affiliate,
            },
            required: ['gia_moi'],
        },
        // Cửa Shopee Pilot (09/11/2026): kế hoạch + thucThi của Pilot, không gọi thẳng doiGiaShopee nữa — lib/shopeePilot.doiGiaQuaPilot
        run: async (a, ctx) => doiGiaQuaPilot(await ngCanhPilot(ctx, a), a),
    },
    {
        name: 'shopee_toggle_listing',
        description: 'ẨN (an=true) hoặc HIỆN LẠI (an=false) một sản phẩm trên gian Shopee — vd hết hàng lâu, hoặc giá đang lỗ chờ chủ shop xem. ' +
            'HIỆN LẠI bị từ chối nếu giá đang bán (từng phân loại) dưới GIÁ SÀN, thiếu giá vốn hoặc phí sàn chưa đủ tin — đổi giá trước rồi mới hiện. ' +
            `Đi qua Shopee Pilot: Pilot đang Xem trước thì KHÔNG ẩn / hiện được (chỉ chủ shop) — báo chủ shop mã và lý do. Tự động: tính vào trần ghi / ngày của Pilot; ẨN tối đa ${TRAN_AN_AI_MOI_NGAY} mã / gian / ngày, ` +
            'hàng còn tồn và có đơn trong 14 ngày thì không tự ẩn (cần chủ shop duyệt).',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                item_id: { type: 'string', description: 'item_id Shopee' },
                an: { type: 'boolean', description: 'true = ẩn, false = hiện lại' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                ly_do: { type: 'string', description: 'Lý do (ghi vào nhật ký)' },
            },
            required: ['item_id', 'an'],
        },
        // Cửa Shopee Pilot (09/11/2026): trước đó ẩn hàng KHÔNG có rào nào — lib/shopeePilot.anHienQuaPilot
        run: async (a, ctx) => anHienQuaPilot(await ngCanhPilot(ctx, a), a),
    },
]

/** AI tự quản gian Shopee là phần của Shopee Pilot — tiện ích quản trị bật theo cửa hàng (01/11/2026,
 *  lib/tienIchCuaHang). Chặn NGAY TRONG run nên mọi đường gọi đều qua cửa này: /api/mcp, tác vụ AI chạy
 *  theo lịch (aiAgentCron), chạy tay ở trang AI. Cờ tienIch để tools/list ẩn tool khi chưa bật. */
export const SHOPEE_TOOLS: Tool[] = CAC_TOOL.map(t => ({
    ...t,
    tienIch: TIEN_ICH_SHOPEE_PILOT,
    run: async (args: any, ctx: ToolCtx) => {
        const lyDo = await lyDoChanPilot(ctx.storeCode)
        if (lyDo) throw new ToolError(lyDo.loi)
        return t.run(args, ctx)
    },
}))

/** Tool ghi ra Shopee — tác vụ tự động phải khai đích danh (thêm vào TOOL_NHAY_CAM). */
export const SHOPEE_TOOL_NHAY_CAM = ['shopee_create_listing', 'shopee_update_price', 'shopee_toggle_listing'] as const
