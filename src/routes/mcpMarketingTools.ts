// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — AI MARKETING (lên content cho fanpage)
//
//  Khác biệt với bộ FANPAGE_TOOLS: bộ này KHÔNG đẩy gì ra ngoài. Agent chỉ
//  soạn bài vào hàng đợi CHỜ DUYỆT (FbContentDraft.status='pending'); chủ shop
//  bấm duyệt ở kengi.vn/fanpage-manager thì bài mới thật sự lên lịch Facebook.
//  Nhờ vậy job tự động chỉ cần allowWrite, không phải mở tool nhạy cảm.
//
//  "Chuẩn chỉnh" nằm ở 3 chỗ, và đều được ép Ở SERVER chứ không trông chờ model:
//    1. Nguyên liệu là DỮ LIỆU THẬT (hàng bán chạy, tồn, khuyến mãi, ảnh sản
//       phẩm) — marketing_content_material. Không có nguồn này agent sẽ bịa.
//    2. Giờ đăng do server phát (marketing_suggest_slots) theo khung giờ vàng và
//       né bài đã có — không để model tự nghĩ ra giờ rồi dồn cục.
//    3. Bài lưu vào phải qua cổng kiểm duyệt (kiemDuyet): từ cấm, cam kết sai
//       luật quảng cáo, thiếu CTA, hook quá dài, trùng nội dung, trùng giờ.
// ═══════════════════════════════════════════════════════════════════════════════

import { Tool, ToolCtx, ToolError } from '../lib/mcpTypes'

// ─── Hằng số nghiệp vụ ───────────────────────────────────────────────────────

/** Trụ nội dung (content pillar). Tên tiếng Việt không dấu để model gõ đúng. */
export const PILLARS = [
    'giao-duc',    // kiến thức, mẹo dùng, cách chọn — nuôi lòng tin
    'san-pham',    // giới thiệu hàng, tính năng, so sánh
    'khuyen-mai',  // giảm giá, combo, deal
    'chung-thuc',  // review khách, ảnh khách dùng, số liệu bán
    'hau-truong',  // chuyện shop, người thật việc thật
    'tuong-tac',   // hỏi đáp, bình chọn, mini game
    'xu-huong',    // bắt trend, ngày lễ, mùa vụ
] as const

/**
 * Tỉ lệ mặc định mỗi 10 bài — theo nguyên tắc 80/20: 8 bài cho đi giá trị,
 * 2 bài bán hàng trực diện. Shop nào cũng sửa được qua hồ sơ thương hiệu.
 */
const PILLAR_MAC_DINH: Record<string, number> = {
    'giao-duc': 3, 'san-pham': 2, 'chung-thuc': 2,
    'tuong-tac': 1, 'hau-truong': 1, 'khuyen-mai': 1,
}

/** Khung giờ vàng của người Việt trên Facebook (giờ VN). */
const GIO_VANG_MAC_DINH = [7, 12, 20]

/**
 * Cam kết bị cấm/rủi ro trong quảng cáo (Luật Quảng cáo 2012 điều 8 + chính sách
 * Meta). Không chặn cứng vì có ngành dùng hợp lệ, nhưng phải trả cảnh báo để
 * agent tự sửa và chủ shop nhìn thấy trước khi duyệt.
 */
const CUM_TU_RUI_RO = [
    'tốt nhất', 'số 1', 'số một', 'duy nhất', 'nhất thế giới', 'nhất việt nam',
    'cam kết 100%', '100% khỏi', 'chữa khỏi', 'đặc trị', 'thần dược',
    'không tác dụng phụ', 'hiệu quả tuyệt đối', 'rẻ nhất',
]

/** Dấu hiệu có lời kêu gọi hành động. Thiếu CTA là lỗi content phổ biến nhất. */
const DAU_HIEU_CTA = [
    'inbox', 'nhắn tin', 'nhắn ngay', 'comment', 'bình luận', 'để lại',
    'gọi', 'liên hệ', 'đặt hàng', 'order', 'ghé', 'xem thêm', 'đăng ký',
    'ib', 'chốt đơn', 'link', 'zalo', 'hotline',
]

const VN_OFFSET_MS = 7 * 60 * 60 * 1000

// ─── Helpers ─────────────────────────────────────────────────────────────────

const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

function jsonMang(raw: any, mac: any[] = []): any[] {
    if (Array.isArray(raw)) return raw
    try { const v = JSON.parse(String(raw || '[]')); return Array.isArray(v) ? v : mac } catch { return mac }
}
function jsonObj(raw: any, mac: Record<string, any> = {}): Record<string, any> {
    try { const v = JSON.parse(String(raw || '{}')); return v && typeof v === 'object' && !Array.isArray(v) ? v : mac } catch { return mac }
}

/** Định dạng mốc thời gian theo GIỜ VN cho agent đọc (server chạy UTC). */
function gioVN(d: Date | string | null | undefined): string | null {
    if (!d) return null
    const t = new Date(d).getTime()
    if (!Number.isFinite(t)) return null
    return new Date(t + VN_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16) + ' (giờ VN)'
}

/**
 * Đọc thời điểm agent gửi. Không kèm múi giờ = GIỜ VIỆT NAM.
 * Cùng quy ước với parseGioHen của mcpFanpageTools — lệch 7 tiếng là lỗi im lặng
 * đã dính một lần ở luồng hẹn đăng, không để tái diễn.
 */
function docGio(raw: string, nhan = 'thời điểm'): number {
    const s = String(raw || '').trim()
    if (!s) throw new ToolError(`Thiếu ${nhan}`)
    const coMuiGio = /(Z|[+-]\d{2}:?\d{2})$/i.test(s)
    const chuan = s.includes('T') ? s : s.replace(' ', 'T')
    const dayDu = coMuiGio ? chuan : `${chuan}${chuan.length === 16 ? ':00' : ''}+07:00`
    const ms = new Date(dayDu).getTime()
    if (!Number.isFinite(ms)) {
        throw new ToolError(`Không đọc được ${nhan} "${raw}" — dùng dạng 2026-08-05T20:00:00 (mặc định giờ VN).`)
    }
    return ms
}

/** Hồ sơ thương hiệu là SINGLETON của store — luôn findFirst, không tạo bản thứ hai. */
async function layHoSo(prisma: any): Promise<any | null> {
    return prisma.fbBrandProfile.findFirst({ orderBy: { createdAt: 'asc' } }).catch(() => null)
}

/** Page đang dùng. Bỏ trống pageId khi store chỉ có 1 page (giống bộ fanpage tools). */
async function chonPage(prisma: any, pageId?: string): Promise<any> {
    const active = { status: { not: 'disconnected' } }
    if (pageId) {
        const p = await prisma.fbPage.findFirst({ where: { pageId: String(pageId), ...active } })
        if (!p) throw new ToolError(`Không tìm thấy fanpage "${pageId}". Gọi fanpage_list_pages để xem danh sách.`)
        return p
    }
    const pages = await prisma.fbPage.findMany({ where: active, take: 5, orderBy: { createdAt: 'asc' } })
    if (!pages.length) throw new ToolError('Store chưa kết nối fanpage nào — vào kengi.vn/fanpage-manager kết nối trước khi lên content.')
    if (pages.length > 1) {
        throw new ToolError(`Store có ${pages.length} fanpage — phải nói rõ page_id: ` + pages.map((p: any) => `${p.name} (${p.pageId})`).join(', '))
    }
    return pages[0]
}

/**
 * Dấu thanh/dấu mũ tách ra sau normalize('NFD') (U+0300–U+036F).
 * Dựng bằng new RegExp từ chuỗi escape thay vì viết ký tự thật vào file nguồn —
 * các ký tự tổ hợp này vô hình trong editor, rất dễ bị công cụ khác làm hỏng.
 */
const DAU_TO_HOP = new RegExp('[\\u0300-\\u036f]', 'g')

/** Bỏ dấu + thường hoá để so trùng nội dung. */
function chuanHoa(s: string): string {
    return String(s || '').toLowerCase().normalize('NFD').replace(DAU_TO_HOP, '')
        .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Độ giống nhau thô theo từ chung (Jaccard) — đủ để bắt bài viết lại gần y nguyên. */
function doGiong(a: string, b: string): number {
    const ta = new Set(chuanHoa(a).split(' ').filter(w => w.length > 3))
    const tb = new Set(chuanHoa(b).split(' ').filter(w => w.length > 3))
    if (!ta.size || !tb.size) return 0
    let chung = 0
    ta.forEach(w => { if (tb.has(w)) chung++ })
    return chung / new Set([...ta, ...tb]).size
}

/**
 * CỔNG KIỂM DUYỆT — chạy trước khi lưu bài nháp.
 * Lỗi (throw) = bài không được lưu, agent buộc viết lại.
 * Cảnh báo = vẫn lưu nhưng ghi rõ để agent sửa và chủ shop thấy trước khi duyệt.
 */
function kiemDuyet(message: string, hook: string, hoSo: any): { canhBao: string[] } {
    const canhBao: string[] = []
    const thap = message.toLowerCase()

    // 1. Từ CẤM do chủ shop khai → chặn cứng, đây là ý chí của chủ shop
    const cam = jsonMang(hoSo?.bannedWords).map((w: any) => String(w).toLowerCase()).filter(Boolean)
    const dinhCam = cam.filter(w => thap.includes(w))
    if (dinhCam.length) {
        throw new ToolError(`Bài chứa từ CẤM của thương hiệu: ${dinhCam.join(', ')}. Viết lại, tuyệt đối không dùng các từ này.`)
    }

    // 2. Cam kết tuyệt đối — rủi ro pháp lý + hay bị Meta hạ tiếp cận
    const dinhRuiRo = CUM_TU_RUI_RO.filter(w => thap.includes(w))
    if (dinhRuiRo.length) {
        canhBao.push(`Có cụm cam kết tuyệt đối dễ vi phạm quảng cáo: "${dinhRuiRo.join('", "')}" — nên đổi sang cách nói có dẫn chứng.`)
    }

    // 3. Độ dài — quá ngắn thì không đủ thuyết phục, quá dài thì không ai đọc hết
    if (message.trim().length < 60) canhBao.push('Bài quá ngắn (<60 ký tự) — khó đủ thông tin để khách hành động.')
    if (message.length > 2000) canhBao.push('Bài quá dài (>2000 ký tự) — cân nhắc cắt bớt, người đọc Facebook rất ít khi kéo hết.')

    // 4. Hook — Facebook cắt khoảng 125 ký tự rồi mới hiện "Xem thêm"
    const hookThat = (hook || message.split('\n')[0] || '').trim()
    if (!hookThat) canhBao.push('Chưa có câu mở (hook) — 1-2 dòng đầu quyết định khách có bấm "Xem thêm" hay không.')
    else if (hookThat.length > 125) canhBao.push(`Câu mở dài ${hookThat.length} ký tự — Facebook cắt ở khoảng 125, ý chính sẽ bị giấu sau "Xem thêm".`)

    // 5. CTA
    if (!DAU_HIEU_CTA.some(k => thap.includes(k))) {
        canhBao.push('Không thấy lời kêu gọi hành động (inbox / bình luận / gọi / đặt hàng) — bài hay mà không có CTA thì không ra đơn.')
    }

    // 6. TOÀN CHỮ HOA — Meta coi là spam
    const chuHoa = (message.match(/[A-ZÀ-Ỹ]/g) || []).length
    const chuCai = (message.match(/[a-zA-ZÀ-ỹà-ỹ]/g) || []).length
    if (chuCai > 50 && chuHoa / chuCai > 0.5) canhBao.push('Quá nhiều CHỮ IN HOA — Facebook hay coi là spam và giảm tiếp cận.')

    return { canhBao }
}

const PAGE_ID_PROP = {
    page_id: { type: 'string', description: 'Facebook Page ID. Bỏ trống nếu store chỉ có 1 fanpage.' },
} as const

// ═══════════════════════════════════════════════════════════════════════════════
//  TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

export const MARKETING_TOOLS: Tool[] = [
    // ─── ĐỌC ─────────────────────────────────────────────────────────────────
    {
        name: 'marketing_get_brand',
        description: 'Hồ sơ thương hiệu của shop: bán gì, khách là ai, giọng văn, điểm mạnh, lời kêu gọi, hashtag, từ cấm, tần suất đăng, khung giờ vàng, tỉ lệ trụ nội dung. GỌI ĐẦU TIÊN trước khi viết bất kỳ bài nào — không có hồ sơ thì bài viết ra chỉ là văn mẫu chung chung.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a, { prisma }: ToolCtx) => {
            const h = await layHoSo(prisma)
            if (!h) {
                return {
                    daKhaiBao: false,
                    ghiChu: 'Shop CHƯA khai hồ sơ thương hiệu. Hãy gọi marketing_content_material để nhìn hàng hoá thật, '
                        + 'suy ra ngành hàng + khách mục tiêu, rồi gọi marketing_set_brand ghi lại một bản nháp hồ sơ. '
                        + 'Nêu rõ trong báo cáo là hồ sơ do AI suy đoán để chủ shop vào sửa lại.',
                    macDinhDangDung: { truNoiDung: PILLAR_MAC_DINH, gioVang: GIO_VANG_MAC_DINH, baiMoiTuan: 5 },
                }
            }
            const mix = jsonObj(h.pillarMix)
            return {
                daKhaiBao: true,
                thuongHieu: h.brandName || null,
                nganhHang: h.industry || null,
                khachMucTieu: h.audience || null,
                giongVan: h.toneOfVoice,
                mucDoEmoji: h.emojiLevel,
                diemManh: h.usp || null,
                loiKeuGoiMacDinh: h.cta || null,
                hashtagThuongHieu: jsonMang(h.hashtags),
                tuCAM: jsonMang(h.bannedWords),
                baiMoiTuan: h.postsPerWeek,
                gioVang: jsonMang(h.bestHours).length ? jsonMang(h.bestHours) : GIO_VANG_MAC_DINH,
                truNoiDung: Object.keys(mix).length ? mix : PILLAR_MAC_DINH,
                danDoThem: h.notes || null,
                thieuSot: [
                    !h.brandName && 'tên thương hiệu',
                    !h.audience && 'chân dung khách hàng',
                    !h.usp && 'điểm mạnh khác biệt',
                    !h.cta && 'lời kêu gọi',
                ].filter(Boolean),
            }
        },
    },
    {
        name: 'marketing_content_material',
        description: 'NGUYÊN LIỆU viết bài lấy từ dữ liệu bán hàng THẬT của shop: hàng bán chạy gần đây, hàng tồn nhiều cần đẩy, hàng mới về, khuyến mãi đang chạy — kèm giá và URL ảnh sản phẩm có sẵn. BẮT BUỘC gọi trước khi viết bài sản phẩm/khuyến mãi: mọi tên hàng, giá, ảnh trong bài phải lấy từ đây, TUYỆT ĐỐI không bịa.',
        inputSchema: {
            type: 'object',
            properties: {
                days: { type: 'number', description: 'Số ngày gần nhất xét bán chạy (mặc định 30, tối đa 180)' },
                limit: { type: 'number', description: 'Số mặt hàng mỗi nhóm (mặc định 8, tối đa 20)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const days = clamp(num(a?.days, 30), 1, 180)
            const limit = clamp(num(a?.limit, 8), 1, 20)
            const tu = new Date(Date.now() - days * 86400_000)

            // Chạy TUẦN TỰ có chủ ý: pool Prisma mỗi store rất nhỏ, Promise.all
            // nhiều query nặng ở đây từng làm cạn kết nối khi đụng giờ cron.
            const banChayRaw = await prisma.transactionItem.groupBy({
                by: ['productId', 'productName'],
                where: { transaction: { createdAt: { gte: tu }, status: { in: ['completed', 'partial'] } } },
                _sum: { quantity: true, lineTotal: true },
                orderBy: { _sum: { quantity: 'desc' } },
                take: limit,
            }).catch(() => [] as any[])

            const idBanChay = banChayRaw.map((r: any) => r.productId).filter(Boolean)

            const tonNhieu = await prisma.product.findMany({
                where: { productType: 'goods', stock: { gt: 0 }, id: { notIn: idBanChay.length ? idBanChay : ['_'] } },
                orderBy: { stock: 'desc' },
                take: limit,
                select: { id: true, name: true, sku: true, sellingPrice: true, stock: true },
            }).catch(() => [] as any[])

            const hangMoi = await prisma.product.findMany({
                where: { productType: 'goods', createdAt: { gte: new Date(Date.now() - 60 * 86400_000) } },
                orderBy: { createdAt: 'desc' },
                take: limit,
                select: { id: true, name: true, sku: true, sellingPrice: true, stock: true, createdAt: true },
            }).catch(() => [] as any[])

            const khuyenMai = await prisma.promotion.findMany({
                where: { status: 'active', endDate: { gte: new Date() } },
                orderBy: { endDate: 'asc' },
                take: 10,
            }).catch(() => [] as any[])

            // Ảnh sản phẩm THẬT — nguồn media duy nhất được phép dùng cho bài viết
            const idCanAnh = [...new Set([...idBanChay, ...tonNhieu.map((p: any) => p.id), ...hangMoi.map((p: any) => p.id)])]
            const anh = idCanAnh.length
                ? await prisma.productImage.findMany({
                    where: { productId: { in: idCanAnh } },
                    select: { productId: true, url: true, isPrimary: true },
                }).catch(() => [] as any[])
                : []
            const anhTheoSp = new Map<string, string[]>()
            for (const im of anh as any[]) {
                const arr = anhTheoSp.get(im.productId) || []
                im.isPrimary ? arr.unshift(im.url) : arr.push(im.url)
                anhTheoSp.set(im.productId, arr)
            }

            // Giá của hàng bán chạy (groupBy không kéo theo được)
            const spBanChay = idBanChay.length
                ? await prisma.product.findMany({
                    where: { id: { in: idBanChay } },
                    select: { id: true, name: true, sku: true, sellingPrice: true, stock: true, description: true },
                }).catch(() => [] as any[])
                : []
            const spTheoId = new Map((spBanChay as any[]).map((p: any) => [p.id, p]))

            const goiY = (p: any) => ({
                product_id: p.id, ten: p.name, sku: p.sku,
                gia: p.sellingPrice, tonKho: p.stock,
                anh: anhTheoSp.get(p.id) || [],
            })

            return {
                khoangXet: `${days} ngày gần nhất`,
                huongDan: 'Chỉ dùng tên hàng, giá và URL ảnh xuất hiện trong kết quả này. Không có ảnh thì để mediaUrls rỗng '
                    + 'và viết mediaIdea mô tả ảnh nên chụp — KHÔNG được bịa link ảnh.',
                hangBanChay: banChayRaw.map((r: any) => {
                    const p = spTheoId.get(r.productId)
                    return {
                        product_id: r.productId, ten: r.productName,
                        daBan: r._sum?.quantity || 0, doanhThu: r._sum?.lineTotal || 0,
                        gia: p?.sellingPrice ?? null, tonKho: p?.stock ?? null,
                        moTa: p?.description || null,
                        anh: anhTheoSp.get(r.productId) || [],
                    }
                }),
                hangTonNhieuCanDay: (tonNhieu as any[]).map(goiY),
                hangMoiVe: (hangMoi as any[]).map((p: any) => ({ ...goiY(p), veLuc: p.createdAt })),
                khuyenMaiDangChay: (khuyenMai as any[]).map((k: any) => ({
                    ma: k.code, ten: k.name,
                    uuDai: k.type === 'percentage' ? `giảm ${k.value}%` : `giảm ${k.value.toLocaleString('vi-VN')}đ`,
                    donToiThieu: k.minOrderValue || null,
                    denNgay: gioVN(k.endDate),
                })),
                soAnhCoSan: anh.length,
            }
        },
    },
    {
        name: 'marketing_suggest_slots',
        description: 'Server tính sẵn các KHUNG GIỜ ĐĂNG còn trống trong khoảng ngày, theo khung giờ vàng + tần suất trong hồ sơ thương hiệu, đã né bài nháp và bài đã lên lịch sẵn có. LUÔN dùng giờ từ tool này cho suggested_at khi lưu bài — đừng tự nghĩ ra giờ.',
        inputSchema: {
            type: 'object',
            properties: {
                ...PAGE_ID_PROP,
                from: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD (mặc định ngày mai, giờ VN)' },
                days: { type: 'number', description: 'Số ngày cần phủ (mặc định 7, tối đa 60)' },
                count: { type: 'number', description: 'Số khung giờ cần lấy (mặc định theo tần suất trong hồ sơ, tối đa 60)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const page = await chonPage(prisma, a?.page_id)
            const hoSo = await layHoSo(prisma)
            const soNgay = clamp(num(a?.days, 7), 1, 60)
            const gioVang: number[] = (jsonMang(hoSo?.bestHours).map((x: any) => clamp(num(x, 20), 0, 23)) as number[])
            const gio = gioVang.length ? [...new Set(gioVang)].sort((x, y) => x - y) : GIO_VANG_MAC_DINH
            const baiTuan = clamp(num(hoSo?.postsPerWeek, 5), 1, 21)
            const canLay = clamp(num(a?.count, Math.max(1, Math.round(baiTuan * soNgay / 7))), 1, 60)

            // Mốc bắt đầu: 00:00 giờ VN của ngày yêu cầu (mặc định NGÀY MAI —
            // hôm nay thường đã trôi qua giờ vàng, hẹn vào là Facebook từ chối).
            const batDau = a?.from
                ? docGio(`${String(a.from).slice(0, 10)}T00:00:00`, 'ngày bắt đầu')
                : (() => { const v = new Date(Date.now() + VN_OFFSET_MS); v.setUTCHours(0, 0, 0, 0); return v.getTime() - VN_OFFSET_MS + 86400_000 })()

            // Giờ ĐÃ CHIẾM: bài nháp chờ duyệt/đã duyệt + bài đã lên lịch trên FB
            const den = batDau + soNgay * 86400_000
            const draftDaCo = await prisma.fbContentDraft.findMany({
                where: { pageId: page.pageId, status: { in: ['pending', 'scheduled'] }, suggestedAt: { gte: new Date(batDau - 86400_000), lte: new Date(den) } },
                select: { suggestedAt: true },
            }).catch(() => [] as any[])
            const lichDaCo = await prisma.fbScheduledPost.findMany({
                where: { pageId: page.pageId, status: 'scheduled', scheduledAt: { gte: new Date(batDau - 86400_000), lte: new Date(den) } },
                select: { scheduledAt: true },
            }).catch(() => [] as any[])
            const daChiem = [
                ...(draftDaCo as any[]).map((d: any) => new Date(d.suggestedAt).getTime()),
                ...(lichDaCo as any[]).map((d: any) => new Date(d.scheduledAt).getTime()),
            ].filter(Number.isFinite)

            const CACH_NHAU = 90 * 60_000  // hai bài cách nhau tối thiểu 90 phút
            const toiThieu = Date.now() + 30 * 60_000  // FB cần ≥10 phút; lấy 30 cho chắc
            const slots: any[] = []
            for (let d = 0; d < soNgay && slots.length < canLay; d++) {
                for (const h of gio) {
                    if (slots.length >= canLay) break
                    const ms = batDau + d * 86400_000 + h * 3600_000
                    if (ms < toiThieu) continue
                    if (daChiem.some(t => Math.abs(t - ms) < CACH_NHAU)) continue
                    daChiem.push(ms)
                    const vn = new Date(ms + VN_OFFSET_MS)
                    slots.push({
                        suggested_at: new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 19), // chuỗi GIỜ VN, dùng nguyên văn
                        moTa: `${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][vn.getUTCDay()]} ${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')} lúc ${String(vn.getUTCHours()).padStart(2, '0')}:00 giờ VN`,
                    })
                }
            }
            return {
                fanpage: page.name,
                gioVangDangDung: gio,
                baiMoiTuan: baiTuan,
                soKhungTraVe: slots.length,
                ghiChu: slots.length < canLay
                    ? `Chỉ còn ${slots.length}/${canLay} khung trống trong ${soNgay} ngày — các giờ khác đã có bài. Muốn thêm thì nới days.`
                    : 'Dùng nguyên văn giá trị suggested_at khi gọi marketing_save_draft (đã là giờ VN).',
                khungGio: slots,
            }
        },
    },
    {
        name: 'marketing_list_drafts',
        description: 'Danh sách bài nháp trong hàng đợi: chờ duyệt, đã duyệt/lên lịch, bị từ chối. Gọi trước khi viết mới để không trùng nội dung và biết chủ shop đã bỏ những bài kiểu gì.',
        inputSchema: {
            type: 'object',
            properties: {
                ...PAGE_ID_PROP,
                status: { type: 'string', enum: ['pending', 'scheduled', 'published', 'rejected', 'all'], description: 'Mặc định pending' },
                limit: { type: 'number', description: 'Mặc định 20, tối đa 100' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const page = await chonPage(prisma, a?.page_id)
            const st = String(a?.status || 'pending')
            const rows = await prisma.fbContentDraft.findMany({
                where: { pageId: page.pageId, ...(st === 'all' ? {} : { status: st }) },
                orderBy: [{ suggestedAt: 'asc' }, { createdAt: 'desc' }],
                take: clamp(num(a?.limit, 20), 1, 100),
            })
            return {
                fanpage: page.name,
                locTheo: st,
                soBai: rows.length,
                baiNhap: rows.map((r: any) => ({
                    id: r.id, truNoiDung: r.pillar, tieuDe: r.title || null,
                    hook: r.hook || null,
                    noiDung: (r.message || '').slice(0, 400),
                    hashtag: jsonMang(r.hashtags),
                    ynghiaAnh: r.mediaIdea || null,
                    soAnh: jsonMang(r.mediaUrls).length,
                    gioDeXuat: gioVN(r.suggestedAt),
                    trangThai: r.status === 'pending' ? 'CHỜ CHỦ SHOP DUYỆT'
                        : r.status === 'scheduled' ? 'đã duyệt, đã lên lịch Facebook'
                            : r.status === 'published' ? 'đã đăng'
                                : `bị từ chối${r.rejectReason ? ': ' + r.rejectReason : ''}`,
                })),
            }
        },
    },
    {
        name: 'marketing_list_plans',
        description: 'Danh sách kế hoạch nội dung đã lập kèm số bài từng trạng thái. Dùng để biết đã lên kế hoạch tới đâu, tránh lập chồng cho cùng một khoảng thời gian.',
        inputSchema: {
            type: 'object',
            properties: { ...PAGE_ID_PROP, limit: { type: 'number', description: 'Mặc định 10, tối đa 50' } },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const page = await chonPage(prisma, a?.page_id)
            const plans = await prisma.fbContentPlan.findMany({
                where: { pageId: page.pageId },
                orderBy: { createdAt: 'desc' },
                take: clamp(num(a?.limit, 10), 1, 50),
                include: { drafts: { select: { status: true } } },
            })
            return {
                fanpage: page.name,
                soKeHoach: plans.length,
                keHoach: plans.map((p: any) => {
                    const dem: Record<string, number> = {}
                    for (const d of p.drafts) dem[d.status] = (dem[d.status] || 0) + 1
                    return {
                        id: p.id, ten: p.title, mucTieu: p.goal || null,
                        tuNgay: gioVN(p.fromDate), denNgay: gioVN(p.toDate),
                        trangThai: p.status, soBai: p.drafts.length, theoTrangThai: dem,
                    }
                }),
            }
        },
    },
    {
        name: 'marketing_post_performance',
        description: 'Phân tích bài ĐÃ ĐĂNG trên fanpage để biết kiểu bài nào chạy tốt: tương tác theo khung giờ, theo độ dài bài, top bài tốt nhất và kém nhất. Gọi trước khi lên kế hoạch mới để lặp lại cái đang hiệu quả thay vì đoán.',
        inputSchema: {
            type: 'object',
            properties: { ...PAGE_ID_PROP, limit: { type: 'number', description: 'Số bài gần nhất cần phân tích (mặc định 25, tối đa 50)' } },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const page = await chonPage(prisma, a?.page_id)
            // import động: tránh kéo Graph service vào mọi chỗ import file này
            const { FacebookService } = await import('../services/platforms/facebook')
            const svc = new FacebookService(page.accessToken)
            let posts: any[] = []
            try {
                posts = await svc.listPublishedPosts(page.pageId, clamp(num(a?.limit, 25), 1, 50)) as any[]
            } catch (e: any) {
                if (e?.isTokenError) {
                    await prisma.fbPage.update({ where: { pageId: page.pageId }, data: { status: 'token_expired' } }).catch(() => { })
                    throw new ToolError('Token Facebook hết hạn — chủ shop cần kết nối lại ở kengi.vn/fanpage-manager. Chưa phân tích được.')
                }
                throw new ToolError(`Facebook báo lỗi khi lấy bài: ${e?.message || 'không rõ'}`)
            }
            if (!posts.length) return { fanpage: page.name, soBai: 0, ghiChu: 'Fanpage chưa có bài đã đăng nào để học.' }

            const diem = (p: any) => (p.reactions?.summary?.total_count ?? 0)
                + 2 * (p.comments?.summary?.total_count ?? 0) + 3 * (p.shares?.count ?? 0)

            const theoGio = new Map<number, { soBai: number; tong: number }>()
            const theoDoDai = { ngan: { soBai: 0, tong: 0 }, vua: { soBai: 0, tong: 0 }, dai: { soBai: 0, tong: 0 } }
            for (const p of posts) {
                const d = diem(p)
                const gio = new Date(new Date(p.created_time).getTime() + VN_OFFSET_MS).getUTCHours()
                const o = theoGio.get(gio) || { soBai: 0, tong: 0 }
                o.soBai++; o.tong += d; theoGio.set(gio, o)
                const len = (p.message || '').length
                const nhom = len < 200 ? 'ngan' : len < 600 ? 'vua' : 'dai'
                theoDoDai[nhom].soBai++; theoDoDai[nhom].tong += d
            }
            const xepGio = [...theoGio.entries()]
                .map(([g, o]) => ({ gioVN: g, soBai: o.soBai, tuongTacTB: Math.round(o.tong / o.soBai) }))
                .sort((x, y) => y.tuongTacTB - x.tuongTacTB)
            const sapXep = [...posts].sort((x, y) => diem(y) - diem(x))

            const goiTat = (p: any) => ({
                noiDung: (p.message || '(không có chữ)').slice(0, 160),
                dangLuc: gioVN(p.created_time),
                camXuc: p.reactions?.summary?.total_count ?? 0,
                binhLuan: p.comments?.summary?.total_count ?? 0,
                chiaSe: p.shares?.count ?? 0,
                diemTuongTac: diem(p),
            })
            return {
                fanpage: page.name,
                soBaiPhanTich: posts.length,
                cachTinhDiem: 'cảm xúc + 2×bình luận + 3×chia sẻ',
                khungGioTotNhat: xepGio.slice(0, 5),
                theoDoDaiBai: {
                    ngan_duoi200: theoDoDai.ngan.soBai ? Math.round(theoDoDai.ngan.tong / theoDoDai.ngan.soBai) : null,
                    vua_200_600: theoDoDai.vua.soBai ? Math.round(theoDoDai.vua.tong / theoDoDai.vua.soBai) : null,
                    dai_tren600: theoDoDai.dai.soBai ? Math.round(theoDoDai.dai.tong / theoDoDai.dai.soBai) : null,
                },
                top3ChayTot: sapXep.slice(0, 3).map(goiTat),
                top3Kem: sapXep.slice(-3).reverse().map(goiTat),
                luuY: posts.length < 8
                    ? 'Mẫu còn ít bài — kết luận chỉ mang tính tham khảo, đừng đổi hẳn hướng nội dung chỉ vì con số này.'
                    : null,
            }
        },
    },

    // ─── GHI (không đẩy ra ngoài — bài chỉ nằm ở hàng đợi chờ duyệt) ─────────
    {
        name: 'marketing_set_brand',
        description: 'Ghi/cập nhật hồ sơ thương hiệu để mọi bài sau này viết đúng giọng shop. Chỉ gửi trường muốn đổi. Nếu tự suy đoán từ dữ liệu hàng hoá thì PHẢI nói rõ trong báo cáo để chủ shop vào sửa lại.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                brand_name: { type: 'string', description: 'Tên thương hiệu/cửa hàng' },
                industry: { type: 'string', description: 'Ngành hàng, VD "mỹ phẩm", "phụ tùng xe máy"' },
                audience: { type: 'string', description: 'Chân dung khách: tuổi, giới, khu vực, nhu cầu/nỗi lo' },
                tone_of_voice: { type: 'string', enum: ['than-thien', 'chuyen-nghiep', 'hai-huoc', 'sang-trong'], description: 'Giọng văn' },
                usp: { type: 'string', description: 'Vì sao khách chọn shop này chứ không phải shop khác' },
                cta: { type: 'string', description: 'Lời kêu gọi mặc định, VD "Inbox để được tư vấn miễn phí"' },
                hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtag thương hiệu, 3-5 cái là đủ' },
                banned_words: { type: 'array', items: { type: 'string' }, description: 'Từ CẤM dùng — bài chứa từ này sẽ bị chặn không lưu được' },
                emoji_level: { type: 'string', enum: ['khong', 'vua', 'nhieu'], description: 'Mức dùng emoji' },
                posts_per_week: { type: 'number', description: 'Số bài mỗi tuần (1-21)' },
                best_hours: { type: 'array', items: { type: 'number' }, description: 'Khung giờ vàng theo GIỜ VN, VD [7,12,20]' },
                pillar_mix: { type: 'object', description: 'Tỉ lệ trụ nội dung, VD {"giao-duc":3,"san-pham":2,"chung-thuc":2,"khuyen-mai":1}' },
                notes: { type: 'string', description: 'Dặn dò thêm cho AI khi viết bài' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma, userId }: ToolCtx) => {
            const data: any = {}
            if (typeof a?.brand_name === 'string') data.brandName = a.brand_name.trim()
            if (typeof a?.industry === 'string') data.industry = a.industry.trim()
            if (typeof a?.audience === 'string') data.audience = a.audience.trim()
            if (['than-thien', 'chuyen-nghiep', 'hai-huoc', 'sang-trong'].includes(String(a?.tone_of_voice))) data.toneOfVoice = String(a.tone_of_voice)
            if (typeof a?.usp === 'string') data.usp = a.usp.trim()
            if (typeof a?.cta === 'string') data.cta = a.cta.trim()
            if (Array.isArray(a?.hashtags)) data.hashtags = JSON.stringify(a.hashtags.map((h: any) => String(h).trim()).filter(Boolean).slice(0, 15))
            if (Array.isArray(a?.banned_words)) data.bannedWords = JSON.stringify(a.banned_words.map((w: any) => String(w).trim()).filter(Boolean).slice(0, 50))
            if (['khong', 'vua', 'nhieu'].includes(String(a?.emoji_level))) data.emojiLevel = String(a.emoji_level)
            if (a?.posts_per_week !== undefined) data.postsPerWeek = clamp(num(a.posts_per_week, 5), 1, 21)
            if (Array.isArray(a?.best_hours)) {
                const gio = [...new Set(a.best_hours.map((h: any) => clamp(num(h, 20), 0, 23)))].sort((x: any, y: any) => x - y)
                data.bestHours = JSON.stringify(gio)
            }
            if (a?.pillar_mix && typeof a.pillar_mix === 'object' && !Array.isArray(a.pillar_mix)) {
                const mix: Record<string, number> = {}
                for (const [k, v] of Object.entries(a.pillar_mix)) {
                    if ((PILLARS as readonly string[]).includes(k) && Number(v) > 0) mix[k] = clamp(num(v, 1), 1, 20)
                }
                if (Object.keys(mix).length) data.pillarMix = JSON.stringify(mix)
            }
            if (typeof a?.notes === 'string') data.notes = a.notes.trim()
            if (!Object.keys(data).length) throw new ToolError('Không có trường nào để cập nhật.')

            const cu = await layHoSo(prisma)
            const h = cu
                ? await prisma.fbBrandProfile.update({ where: { id: cu.id }, data })
                : await prisma.fbBrandProfile.create({ data: { ...data, createdBy: userId || null } })

            return {
                ketQua: cu ? 'Đã cập nhật hồ sơ thương hiệu' : 'Đã tạo hồ sơ thương hiệu',
                daGhi: Object.keys(data),
                conThieu: [
                    !h.brandName && 'tên thương hiệu',
                    !h.audience && 'chân dung khách hàng',
                    !h.usp && 'điểm mạnh khác biệt',
                    !h.cta && 'lời kêu gọi',
                ].filter(Boolean),
            }
        },
    },
    {
        name: 'marketing_create_plan',
        description: 'Tạo KẾ HOẠCH NỘI DUNG cho một khoảng thời gian (khung chứa các bài nháp). Gọi tool này TRƯỚC, lấy plan_id, rồi lần lượt gọi marketing_save_draft cho từng bài của kế hoạch.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Tên kế hoạch, VD "Content tuần 05-11/08"' },
                ...PAGE_ID_PROP,
                goal: { type: 'string', description: 'Mục tiêu, VD "đẩy hàng tồn mùa hè", "tăng inbox tư vấn"' },
                from: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD (giờ VN)' },
                to: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD (giờ VN)' },
            },
            required: ['title'],
            additionalProperties: false,
        },
        run: async (a, { prisma, userId }: ToolCtx) => {
            const title = String(a?.title || '').trim()
            if (!title) throw new ToolError('Thiếu tên kế hoạch')
            const page = await chonPage(prisma, a?.page_id)
            const tuMs = a?.from ? docGio(`${String(a.from).slice(0, 10)}T00:00:00`, 'ngày bắt đầu') : Date.now()
            const denMs = a?.to ? docGio(`${String(a.to).slice(0, 10)}T23:59:59`, 'ngày kết thúc') : tuMs + 7 * 86400_000
            if (denMs < tuMs) throw new ToolError('Ngày kết thúc phải sau ngày bắt đầu.')

            const plan = await prisma.fbContentPlan.create({
                data: {
                    pageId: page.pageId, title, goal: String(a?.goal || '').trim(),
                    fromDate: new Date(tuMs), toDate: new Date(denMs),
                    status: 'active', createdBy: userId || null,
                },
            })
            return {
                ketQua: 'Đã tạo kế hoạch nội dung', plan_id: plan.id, fanpage: page.name,
                tuNgay: gioVN(plan.fromDate), denNgay: gioVN(plan.toDate),
                buocTiepTheo: 'Gọi marketing_suggest_slots lấy khung giờ, rồi marketing_save_draft cho từng bài (kèm plan_id này).',
            }
        },
    },
    {
        name: 'marketing_save_draft',
        description: 'Lưu MỘT bài viết vào hàng đợi CHỜ CHỦ SHOP DUYỆT. Bài KHÔNG lên Facebook cho tới khi chủ shop bấm duyệt — cứ soạn thoải mái. Server sẽ kiểm tra chất lượng (từ cấm, cam kết sai luật, thiếu CTA, hook quá dài, trùng nội dung, trùng giờ) và trả về cảnh báo; hãy đọc cảnh báo và sửa lại nếu cần.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'TOÀN VĂN bài đăng (không kèm hashtag — hashtag để riêng)' },
                pillar: { type: 'string', enum: [...PILLARS], description: 'Trụ nội dung của bài' },
                ...PAGE_ID_PROP,
                plan_id: { type: 'string', description: 'id kế hoạch (từ marketing_create_plan)' },
                title: { type: 'string', description: 'Nhãn ngắn để chủ shop lướt nhanh, VD "Mẹo chọn size"' },
                hook: { type: 'string', description: '1-2 dòng đầu của bài (≤125 ký tự) — thứ quyết định khách có bấm Xem thêm' },
                hashtags: { type: 'array', items: { type: 'string' }, description: '3-5 hashtag, không cần dấu #' },
                media_idea: { type: 'string', description: 'Mô tả ảnh/video nên dùng, để chủ shop tự chụp nếu không có ảnh sẵn' },
                media_urls: { type: 'array', items: { type: 'string' }, description: 'URL ảnh LẤY TỪ marketing_content_material. Không có thì để trống — tuyệt đối không bịa link.' },
                link_url: { type: 'string', description: 'Link đính kèm (nếu có)' },
                product_ids: { type: 'array', items: { type: 'string' }, description: 'product_id các mặt hàng bài này đẩy (từ marketing_content_material)' },
                suggested_at: { type: 'string', description: 'Giờ đề xuất đăng — dùng nguyên văn suggested_at từ marketing_suggest_slots. Không ghi múi giờ = GIỜ VN.' },
            },
            required: ['message', 'pillar'],
            additionalProperties: false,
        },
        run: async (a, { prisma, userId }: ToolCtx) => {
            const message = String(a?.message || '').trim()
            if (!message) throw new ToolError('Nội dung bài không được để trống')
            const pillar = (PILLARS as readonly string[]).includes(String(a?.pillar)) ? String(a.pillar) : 'khac'
            const page = await chonPage(prisma, a?.page_id)
            const hoSo = await layHoSo(prisma)
            const hook = String(a?.hook || '').trim()

            // Cổng kiểm duyệt — ném lỗi nếu dính từ cấm, còn lại trả cảnh báo
            const { canhBao } = kiemDuyet(message, hook, hoSo)

            // Trùng nội dung với bài nháp gần đây → chặn, kẻo đăng lặp
            const ganDay = await prisma.fbContentDraft.findMany({
                where: { pageId: page.pageId, status: { in: ['pending', 'scheduled', 'published'] } },
                orderBy: { createdAt: 'desc' }, take: 40,
                select: { id: true, title: true, message: true },
            })
            const trung = (ganDay as any[]).find((d: any) => doGiong(d.message, message) > 0.62)
            if (trung) {
                throw new ToolError(`Bài này gần trùng bài đã có trong hàng đợi ("${(trung.title || trung.message).slice(0, 60)}…", id ${trung.id}). Viết góc nhìn khác hoặc đổi sang trụ nội dung khác.`)
            }

            // Giờ đề xuất
            let suggestedAt: Date | null = null
            if (a?.suggested_at) {
                const ms = docGio(a.suggested_at, 'giờ đề xuất đăng')
                if (ms < Date.now() + 15 * 60_000) {
                    throw new ToolError(`Giờ đề xuất đã qua hoặc quá sát (${gioVN(new Date(ms))}). Lấy khung giờ mới bằng marketing_suggest_slots.`)
                }
                // Đụng bài khác trong vòng 90 phút → dồn cục, tiếp cận đè nhau
                const dung = await prisma.fbContentDraft.findFirst({
                    where: {
                        pageId: page.pageId, status: { in: ['pending', 'scheduled'] },
                        suggestedAt: { gte: new Date(ms - 90 * 60_000), lte: new Date(ms + 90 * 60_000) },
                    },
                    select: { id: true, suggestedAt: true },
                })
                if (dung) {
                    throw new ToolError(`Đã có bài khác hẹn lúc ${gioVN(dung.suggestedAt)} — hai bài cách nhau dưới 90 phút sẽ tự cạnh tranh tiếp cận. Chọn khung giờ khác từ marketing_suggest_slots.`)
                }
                suggestedAt = new Date(ms)
            } else {
                canhBao.push('Chưa có giờ đề xuất đăng — chủ shop sẽ phải tự chọn giờ khi duyệt. Nên gọi marketing_suggest_slots rồi cập nhật lại.')
            }

            // Kế hoạch (nếu có) phải tồn tại và cùng page
            let planId: string | null = null
            if (a?.plan_id) {
                const plan = await prisma.fbContentPlan.findUnique({ where: { id: String(a.plan_id) } })
                if (!plan) throw new ToolError(`Không tìm thấy kế hoạch id "${a.plan_id}" — gọi marketing_list_plans để lấy id đúng.`)
                if (plan.pageId !== page.pageId) throw new ToolError('Kế hoạch này thuộc fanpage khác.')
                planId = plan.id
            }

            const hashtags = Array.isArray(a?.hashtags)
                ? a.hashtags.map((h: any) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10)
                : []
            const mediaUrls = Array.isArray(a?.media_urls)
                ? a.media_urls.filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 10)
                : []
            if (Array.isArray(a?.media_urls) && a.media_urls.length && !mediaUrls.length) {
                canhBao.push('Các URL ảnh gửi lên không hợp lệ (phải là http/https) nên đã bị bỏ — dùng URL từ marketing_content_material.')
            }
            if (!mediaUrls.length && !String(a?.media_idea || '').trim()) {
                canhBao.push('Bài không có ảnh và cũng không có gợi ý ảnh — bài chỉ có chữ thường tiếp cận kém hơn hẳn.')
            }
            if (!hashtags.length) canhBao.push('Chưa có hashtag — nên gắn 3-5 hashtag để bài dễ được tìm thấy.')

            const draft = await prisma.fbContentDraft.create({
                data: {
                    planId, pageId: page.pageId, pillar,
                    title: String(a?.title || '').trim().slice(0, 120),
                    hook, message,
                    hashtags: JSON.stringify(hashtags),
                    mediaIdea: String(a?.media_idea || '').trim(),
                    mediaUrls: JSON.stringify(mediaUrls),
                    linkUrl: a?.link_url ? String(a.link_url) : null,
                    productIds: JSON.stringify(Array.isArray(a?.product_ids) ? a.product_ids.map(String).slice(0, 20) : []),
                    suggestedAt, status: 'pending', source: 'ai', createdBy: userId || null,
                },
            })
            return {
                ketQua: 'Đã lưu bài vào hàng đợi CHỜ DUYỆT (chưa lên Facebook)',
                draft_id: draft.id, truNoiDung: pillar,
                gioDeXuat: gioVN(suggestedAt),
                canhBao: canhBao.length ? canhBao : null,
                nhacNho: canhBao.length
                    ? 'Có cảnh báo — cân nhắc gọi marketing_update_draft sửa lại trước khi báo cáo cho chủ shop.'
                    : null,
            }
        },
    },
    {
        name: 'marketing_update_draft',
        description: 'Sửa một bài nháp CHƯA duyệt (nội dung, hook, hashtag, ảnh, giờ đề xuất). Bài đã duyệt/đã đăng thì không sửa qua đây được.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'draft_id (từ marketing_list_drafts hoặc marketing_save_draft)' },
                message: { type: 'string', description: 'Nội dung mới' },
                title: { type: 'string' },
                hook: { type: 'string', description: 'Câu mở mới (≤125 ký tự)' },
                hashtags: { type: 'array', items: { type: 'string' } },
                media_idea: { type: 'string' },
                media_urls: { type: 'array', items: { type: 'string' }, description: 'URL ảnh từ marketing_content_material' },
                suggested_at: { type: 'string', description: 'Giờ đề xuất mới (mặc định giờ VN)' },
                pillar: { type: 'string', enum: [...PILLARS] },
            },
            required: ['id'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const draft = await prisma.fbContentDraft.findUnique({ where: { id: String(a?.id || '') } })
            if (!draft) throw new ToolError(`Không tìm thấy bài nháp id "${a?.id}"`)
            if (draft.status !== 'pending') {
                throw new ToolError(`Bài này đang ở trạng thái "${draft.status}" — chỉ sửa được bài còn chờ duyệt.`)
            }
            const hoSo = await layHoSo(prisma)
            const data: any = {}
            const message = typeof a?.message === 'string' && a.message.trim() ? a.message.trim() : draft.message
            const hook = typeof a?.hook === 'string' ? a.hook.trim() : draft.hook
            const { canhBao } = kiemDuyet(message, hook, hoSo)

            if (typeof a?.message === 'string' && a.message.trim()) data.message = message
            if (typeof a?.hook === 'string') data.hook = hook
            if (typeof a?.title === 'string') data.title = a.title.trim().slice(0, 120)
            if (typeof a?.media_idea === 'string') data.mediaIdea = a.media_idea.trim()
            if ((PILLARS as readonly string[]).includes(String(a?.pillar))) data.pillar = String(a.pillar)
            if (Array.isArray(a?.hashtags)) data.hashtags = JSON.stringify(a.hashtags.map((h: any) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10))
            if (Array.isArray(a?.media_urls)) data.mediaUrls = JSON.stringify(a.media_urls.filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 10))
            if (a?.suggested_at) {
                const ms = docGio(a.suggested_at, 'giờ đề xuất đăng')
                if (ms < Date.now() + 15 * 60_000) throw new ToolError('Giờ đề xuất đã qua hoặc quá sát — lấy khung mới bằng marketing_suggest_slots.')
                const dung = await prisma.fbContentDraft.findFirst({
                    where: {
                        pageId: draft.pageId, id: { not: draft.id }, status: { in: ['pending', 'scheduled'] },
                        suggestedAt: { gte: new Date(ms - 90 * 60_000), lte: new Date(ms + 90 * 60_000) },
                    },
                    select: { suggestedAt: true },
                })
                if (dung) throw new ToolError(`Đã có bài khác hẹn lúc ${gioVN(dung.suggestedAt)} — chọn khung giờ khác.`)
                data.suggestedAt = new Date(ms)
            }
            if (!Object.keys(data).length) throw new ToolError('Không có trường nào để cập nhật.')

            const moi = await prisma.fbContentDraft.update({ where: { id: draft.id }, data })
            return {
                ketQua: 'Đã cập nhật bài nháp', draft_id: moi.id,
                gioDeXuat: gioVN(moi.suggestedAt),
                canhBao: canhBao.length ? canhBao : null,
            }
        },
    },
    {
        name: 'marketing_delete_draft',
        description: 'Xoá một bài nháp chưa duyệt khỏi hàng đợi (bài dở, viết trùng, không còn hợp thời điểm).',
        write: true,
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'draft_id' } },
            required: ['id'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const draft = await prisma.fbContentDraft.findUnique({ where: { id: String(a?.id || '') } })
            if (!draft) throw new ToolError(`Không tìm thấy bài nháp id "${a?.id}"`)
            if (draft.status !== 'pending') throw new ToolError(`Bài đang ở trạng thái "${draft.status}" — chỉ xoá được bài còn chờ duyệt.`)
            await prisma.fbContentDraft.delete({ where: { id: draft.id } })
            return { ketQua: 'Đã xoá bài nháp', tieuDeDaXoa: draft.title || draft.message.slice(0, 60) }
        },
    },
]
