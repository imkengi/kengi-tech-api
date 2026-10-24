// ─────────────────────────────────────────────────────────────────────────────
//  /api/chatbot — CHATBOT TRẢ LỜI KHÁCH (20/10/2026).
//  Chủ shop: "giá và sản phẩm lấy từ data đã có chứ" + "phần này giống như là nơi nhận webhook bên n8n để xử lý câu trả
//  lời trả lại cho n8n" ⇒ n8n chỉ chuyển tin nhắn khách tới POST /webhook; kengi.vn tự tra kho kiến thức của shop (soạn ở
//  kengi.vn/chatbot) + sản phẩm / giá thật, AI soạn câu trả lời, trả về cho n8n gửi khách.
//
//  21/10: "không phải tải workflow mà gắn webhook đầu vào và đầu ra để trả kết quả" ⇒ mỗi shop một ĐƯỜNG DẪN ĐẦU VÀO bí
//  mật (POST /vao/<mã cửa hàng>/<khoá> — n8n chỉ dán URL) + URL ĐẦU RA của n8n: kengi.vn xử lý xong POST câu trả lời ra
//  đó (lib/chatbotWebhook.ts) và cũng trả luôn trong phản hồi.
//
//  Xác thực:
//   · /vao/<mã>/<khoá>: khoá trong đường dẫn (đổi được ở trang — link cũ hết dùng ngay).
//   · /webhook, /san-pham, /kenh: X-API-Key (scope 'chatbot') + x-store-code từ n8n, hoặc JWT (thử ở trang chatbot).
//     Khoá 'chatbot' CHỈ gọi được ba đường này (lib/phamViKhoaApi.ts) — lộ khoá cũng không đọc được khách / doanh thu.
//   · /shops (đọc / sửa kho kiến thức, cấu hình webhook): CHỈ JWT của quản lý — khoá API nào cũng không sửa được.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { docThamSoSanPham, traSanPham, LoiTraSanPham, TEN_SAN, SanPhamChatbot } from '../lib/chatbotSanPham'
import {
    kiemShopChatbot, docTinNhan, timKienThuc, soanPromptChatbot, tachCoNhanVien, layPhien, ghiPhien, homNayVN,
    TRA_LOI_DU_PHONG, TaiLieu, TinNhanWebhook,
} from '../lib/chatbotKienThuc'
import {
    damBaoBangChatbot, dsShopChatbot, timShopChatbot, timShopTheoKhoa, luuShopChatbot, xoaShopChatbot, boSungKhoaThieu, datDauRa,
    lamMoiKhoaWebhook, DongShopChatbot,
} from '../lib/chatbotLuuTru'
import { duongVao, laKhoaWebhook, kiemUrlDauRa, guiDauRa, kemTheo, taoGoiDauRa, KetQuaDauRa } from '../lib/chatbotWebhook'
import { getStorePrisma, registryPrisma } from '../lib/prisma'
import { layKeyAi } from '../lib/keyAi'
import { chayAgent, LoiGeminiTamThoi, LoiGeminiHetTien } from '../services/aiAgentRunner'
import { Tool, ToolError } from '../lib/mcpTypes'

const router = Router()
const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin']

// n8n gọi theo từng tin nhắn khách — 120 lượt / phút / IP là dư, chặn vòng lặp hỏng của workflow
router.use(rateLimit({
    windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Gọi quá nhiều lần — thử lại sau 1 phút.' },
}))

const schemaCua = (req: AuthRequest) => String(req.user?.storeSchema || (req.user as any)?.branchSchema || '')

/** Kho kiến thức: chỉ người quản lý ĐĂNG NHẬP (JWT) — không nhận khoá API */
function chiQuanLy(req: AuthRequest, res: Response): boolean {
    if ((req as any).viaApiKey) { res.status(403).json({ success: false, error: 'Kho kiến thức chatbot chỉ sửa được khi đăng nhập kengi.vn, không dùng khoá API' }); return false }
    if (!QUAN_LY.includes(String(req.user?.role || '').toLowerCase())) { res.status(403).json({ success: false, error: 'Chỉ admin / quản lý mới sửa được kho kiến thức chatbot' }); return false }
    return true
}

function docKienThuc(s: DongShopChatbot | null): TaiLieu[] {
    try { const d = JSON.parse(String(s?.kienThuc || '')); return Array.isArray(d?.documents) ? d.documents : [] } catch { return [] }
}

// GET /kenh — các SHOP (tên kênh bán) của cửa hàng + sàn + số listing đang bán. Không trả khoá / token của kênh.
router.get('/kenh', authMiddleware, requirePermission('products.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const kenh: any[] = await prisma.onlineChannel.findMany({
            where: { status: 'active' },
            select: { id: true, name: true, platform: true },
            orderBy: { name: 'asc' },
        })
        const dem: any[] = await prisma.onlineProduct.groupBy({ by: ['channelId'], _count: { _all: true } }).catch(() => [])
        const theoTen = new Map<string, { ten: string; san: string[]; soListing: number }>()
        for (const k of kenh) {
            const ten = String(k.name || '').replace(/\s+/g, ' ').trim()
            if (!ten) continue
            const khoa = ten.toLowerCase()
            const muc = theoTen.get(khoa) || { ten, san: [], soListing: 0 }
            const san = TEN_SAN[String(k.platform || '').toLowerCase()] || String(k.platform || '')
            if (san && !muc.san.includes(san)) muc.san.push(san)
            muc.soListing += Number(dem.find(d => d.channelId === k.id)?._count?._all || 0)
            theoTen.set(khoa, muc)
        }
        res.json({ success: true, data: Array.from(theoTen.values()) })
    } catch (err: any) {
        console.error('[chatbot/kenh]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không đọc được danh sách shop' })
    }
})

// GET /san-pham?q=&ma=&shop=&san=&limit= — tìm sản phẩm khách hỏi (tên / mã), giá theo sàn của shop, tình trạng
router.get('/san-pham', authMiddleware, requirePermission('products.view'), async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: await traSanPham(req.storePrisma!, docThamSoSanPham(req.query as any)) })
    } catch (err: any) {
        if (err instanceof LoiTraSanPham) { res.status(err.ma).json({ success: false, error: err.message }); return }
        console.error('[chatbot/san-pham]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không tra được sản phẩm — thử lại sau' })
    }
})

// ─── Kho kiến thức theo shop (trang kengi.vn/chatbot) ─────────────────────────
router.get('/shops', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!chiQuanLy(req, res)) return
    try {
        const prisma: any = req.storePrisma!
        await damBaoBangChatbot(prisma, schemaCua(req))
        await boSungKhoaThieu(prisma)
        const ds = await dsShopChatbot(prisma)
        res.json({
            success: true,
            data: ds.map(s => ({
                id: s.id, ten: s.ten, kenh: s.kenh, san: s.san, thuTu: s.thuTu,
                kienThuc: (() => { try { return JSON.parse(s.kienThuc) } catch { return { schema_version: 1, documents: [] } } })(),
                capNhatBoi: s.capNhatBoi, capNhatLuc: s.updatedAt,
                ...cauHinhWebhook(req, s),
            })),
        })
    } catch (err: any) {
        console.error('[chatbot/shops]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không đọc được kho kiến thức chatbot' })
    }
})

router.put('/shops/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!chiQuanLy(req, res)) return
    try {
        const kq = kiemShopChatbot(req.params.id, req.body)
        if ('loi' in kq) { res.status(400).json({ success: false, error: kq.loi }); return }
        const prisma: any = req.storePrisma!
        await damBaoBangChatbot(prisma, schemaCua(req))
        await luuShopChatbot(prisma, kq.shop, String(req.user?.email || req.user?.userId || '') || null)
        res.json({ success: true, data: { id: kq.shop.id, capNhatLuc: new Date().toISOString() } })
    } catch (err: any) {
        console.error('[chatbot/shops PUT]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không lưu được kho kiến thức — thử lại' })
    }
})

router.delete('/shops/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!chiQuanLy(req, res)) return
    try {
        const prisma: any = req.storePrisma!
        await damBaoBangChatbot(prisma, schemaCua(req))
        const so = await xoaShopChatbot(prisma, String(req.params.id))
        res.json({ success: true, data: { daXoa: so } })
    } catch (err: any) {
        console.error('[chatbot/shops DELETE]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không xoá được shop' })
    }
})

// ─── WEBHOOK: n8n gửi tin nhắn khách → câu trả lời ────────────────────────────
/** Hai công cụ ĐỌC duy nhất của chatbot — không công cụ nào chạm khách hàng / đơn / giá vốn */
export function congCuChatbot(kenh: string, san: string, taiLieu: TaiLieu[], ghiSanPham: (ds: SanPhamChatbot[]) => void): Tool[] {
    return [{
        name: 'tra_cuu_kien_thuc',
        description: 'Tra kho kiến thức ĐÃ DUYỆT của shop: chính sách, giao hàng, thanh toán, đổi trả, bảo hành, liên hệ, giới thiệu shop. Truyền câu hỏi cụ thể.',
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Câu hỏi / chủ đề cần tra, giữ nguyên tên sản phẩm, địa điểm khách nêu' } }, required: ['query'] },
        run: async (a: any) => timKienThuc(taiLieu, String(a?.query ?? '')),
    }, {
        name: 'tra_cuu_san_pham',
        description: `Tra sản phẩm ĐANG BÁN của shop (dữ liệu thật kengi.vn): tên, mã, giá theo từng sàn, tình trạng, link mua, mô tả. Truyền tên hoặc mã sản phẩm, bỏ từ thừa như "giá", "bao nhiêu", "còn không".`,
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Tên hoặc mã sản phẩm, vd "quạt đứng sunhouse" hoặc "SHD7346"' } }, required: ['query'] },
        run: async (a: any, ctx) => {
            const q = String(a?.query ?? '').trim()
            try {
                const kq = await traSanPham(ctx.prisma, docThamSoSanPham({ q, shop: kenh, san, limit: '5' }))
                ghiSanPham(kq.ketQua)
                return { status: kq.soKetQua ? 'tim_thay' : 'khong_thay', ghi_chu: kq.ghiChu, san_pham: kq.ketQua }
            } catch (e: any) {
                if (e instanceof LoiTraSanPham) throw new ToolError(e.message)
                throw e
            }
        },
    }]
}

/** Kênh bán để tra giá: shop đã chọn ⇒ đúng kênh đó; chưa chọn ⇒ kênh TRÙNG TÊN shop, không có thì giá bán lẻ ('') */
async function kenhCuaShop(prisma: any, shop: DongShopChatbot): Promise<string> {
    if (shop.kenh !== null) return shop.kenh
    const gon = (x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim()
    const ds: any[] = await prisma.onlineChannel.findMany({ where: { status: 'active' }, select: { name: true } })
    return ds.map(k => gon(k.name)).find(n => n.toLowerCase() === gon(shop.ten).toLowerCase()) ?? ''
}

/** Lỗi AI ⇒ câu người dùng làm theo được. 24/10/2026: key Gemini KENGISTORE hết tín dụng trả trước (HTTP 402) — câu thô
 *  tiếng Anh bị cắt giữa chừng, chủ shop không biết phải nạp tiền. Bộ chạy đã xếp 402 vào LoiGeminiHetTien — lớp CON của
 *  LoiGeminiTamThoi nên phải xét trước, kẻo thành "thử lại sau". Không dò "402" trong chữ nữa: lỗi thường còn mang 402 chỉ là
 *  DeepSeek hết tiền, câu của nó đã nói đúng nhà cung cấp — dò chữ là báo nhầm thành Gemini. */
export function loiAiChoNguoiDung(e: any): string {
    if (e instanceof LoiGeminiHetTien) return LoiGeminiHetTien.CAU
    if (e instanceof LoiGeminiTamThoi) return 'AI đang quá tải / hết hạn mức — thử lại sau ít phút'
    const s = String(e?.message || e)
    if (/\b(401|403)\b|API key not valid|PERMISSION_DENIED/i.test(s)) return 'Key AI của cửa hàng sai hoặc đã bị khoá — kiểm tra ở Cài đặt › Trợ lý AI'
    return `AI lỗi: ${s.slice(0, 200)}`
}

export interface KetQuaTin {
    shop: { id: string; ten: string }
    phien: string | null
    traLoi: string
    canNhanVien: boolean
    sanPham: SanPhamChatbot[]
    congCu: { ten: string; ok: boolean }[]
    loi?: string
    ghiChu?: string
}

/** Lõi: một tin nhắn khách → câu trả lời. Dùng chung cho /webhook (khoá API / JWT), /vao (đường dẫn đầu vào) và gợi ý trả
 *  lời ở khung chat sàn (soanGoiYChoSan — themPrompt là luật riêng của sàn). Không ném lỗi AI — AI hỏng / chưa có key ⇒
 *  câu dự phòng + canNhanVien. */
async function xuLyTin(prisma: any, schema: string, storeCode: string, shop: DongShopChatbot, tin: TinNhanWebhook, themPrompt?: string): Promise<KetQuaTin> {
    const khoaPhien = tin.phien ? `${schema}:${shop.id}:${tin.phien}` : ''
    const lichSu = tin.lichSu.length ? tin.lichSu : (khoaPhien ? layPhien(khoaPhien) : [])
    const sanPham: SanPhamChatbot[] = []
    const ghiSanPham = (ds: SanPhamChatbot[]) => { for (const s of ds) if (sanPham.length < 5 && !sanPham.some(x => x.ma === s.ma && x.ten === s.ten)) sanPham.push(s) }
    const nen = { shop: { id: shop.id, ten: shop.ten }, phien: tin.phien || null }

    const kenh = await kenhCuaShop(prisma, shop)
    const key = await layKeyAi(prisma)
    if (!key.gemini && !key.deepseek) {
        return { ...nen, traLoi: TRA_LOI_DU_PHONG, canNhanVien: true, sanPham, congCu: [], loi: 'Cửa hàng chưa cài key AI — admin vào Cài đặt → Trợ lý AI nhập Gemini API Key' }
    }
    let kq: Awaited<ReturnType<typeof chayAgent>>
    try {
        kq = await chayAgent({
            apiKey: key.gemini,
            deepseekKey: key.deepseek,
            systemPrompt: soanPromptChatbot(shop.ten, homNayVN()) + (themPrompt ? `\n\n${themPrompt}` : ''),
            ctx: { prisma, scopes: 'read', storeCode },
            message: tin.cauHoi,
            history: lichSu,
            maxSteps: 5,
            tools: congCuChatbot(kenh, kenh ? shop.san : '', docKienThuc(shop), ghiSanPham),
        })
    } catch (e: any) {
        // AI hỏng (quá tải / hết hạn mức / key sai) ⇒ vẫn trả câu lịch sự + cờ cần người, n8n không phải đoán
        console.warn('[chatbot] AI lỗi:', e?.message || e)
        return { ...nen, traLoi: TRA_LOI_DU_PHONG, canNhanVien: true, sanPham, congCu: [], loi: loiAiChoNguoiDung(e) }
    }
    // bộ chạy trả '(không có nội dung trả lời)' khi model im — KHÔNG gửi chữ đó cho khách
    const rong = kq.chamTran || !String(kq.reply || '').trim() || kq.reply === '(không có nội dung trả lời)'
    const { traLoi, canNhanVien } = rong ? { traLoi: TRA_LOI_DU_PHONG, canNhanVien: true } : tachCoNhanVien(kq.reply)
    if (khoaPhien) ghiPhien(khoaPhien, tin.cauHoi, traLoi)
    return {
        ...nen, traLoi, canNhanVien, sanPham, congCu: kq.toolCalls.map(t => ({ ten: t.name, ok: t.ok })),
        ...(kq.doiSangDeepSeek ? { ghiChu: kq.geminiHetTien ? 'Trả lời bằng DeepSeek (key Gemini HẾT TIỀN — nạp ở AI Studio hoặc đổi key)' : 'Trả lời bằng DeepSeek (Gemini quá tải / hết hạn mức)' } : {}),
    }
}

// ─── GỢI Ý TRẢ LỜI cho khung chat sàn (24/10/2026) ────────────────────────────
/** Luật riêng từng sàn cho câu NHÁP. Shopee cấm kéo khách ra ngoài sàn (SĐT, Zalo, link ngoài, sàn khác). */
export const LUAT_NHAP_SAN: Record<string, string> = {
    shopee: 'Bạn đang soạn NHÁP để nhân viên duyệt rồi tự gửi trong khung chat SHOPEE. Chỉ nói về mua trên Shopee: KHÔNG đưa số điện thoại, Zalo, Facebook, website hay link ngoài Shopee, KHÔNG nhắc sàn khác (Shopee cấm kéo khách ra ngoài sàn). Tin trong ngoặc vuông như [Gửi thẻ sản phẩm: …] là mô tả thẻ khách đã gửi.',
}

/** Kho kiến thức cho một kênh sàn: shop chatbot gắn đúng kênh (ưu tiên đúng sàn) › chưa gắn kênh mà trùng tên › trùng tên ›
 *  cửa hàng chỉ có MỘT shop chatbot. Không có ⇒ null (kho rỗng — AI vẫn tra sản phẩm / giá). */
export function chonShopChoKenh<T extends { ten: string; kenh: string | null; san: string }>(ds: T[], kenh: { name: string; platform: string }): T | null {
    const gon = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    const ten = gon(kenh.name)
    if (!ten) return ds.length === 1 ? ds[0]! : null
    const ganKenh = ds.filter(s => s.kenh !== null && gon(s.kenh) === ten)
    return ganKenh.find(s => s.san === kenh.platform) || ganKenh.find(s => !s.san) || ganKenh[0]
        || ds.find(s => s.kenh === null && gon(s.ten) === ten)
        || ds.find(s => gon(s.ten) === ten)
        || (ds.length === 1 ? ds[0]! : null)
}

/**
 * Soạn GỢI Ý trả lời cho khung chat sàn — nhân viên xem rồi TỰ bấm gửi (luật Chat API Shopee cấm chatbot tự trả lời).
 * Kho kiến thức: chonShopChoKenh. Giá / link: CHỈ của đúng kênh sàn đang chat (khách Shopee không nghe giá sàn khác).
 * KHÔNG nhớ phiên (phien rỗng ⇒ xuLyTin không ghi bộ nhớ), không lưu, không log nội dung tin.
 */
export async function soanGoiYChoSan(prisma: any, schema: string, storeCode: string, kenh: { name: string; platform: string },
    cauHoi: string, lichSu: TinNhanWebhook['lichSu']): Promise<KetQuaTin & { khoKienThuc: string | null }> {
    if (schema) await damBaoBangChatbot(prisma, schema)
    const shop = chonShopChoKenh(await dsShopChatbot(prisma), kenh)
    const ten = String(kenh.name || '').replace(/\s+/g, ' ').trim()
    const goc: DongShopChatbot = shop || {
        id: 'goi-y', ten, kenh: null, san: '', thuTu: 0, kienThuc: JSON.stringify({ schema_version: 1, documents: [] }),
        capNhatBoi: null, updatedAt: new Date(0), webhookToken: null, webhookRa: null, webhookRaKhoa: null,
    }
    const kq = await xuLyTin(prisma, schema, storeCode, { ...goc, ten: ten || goc.ten, kenh: ten, san: kenh.platform },
        { shop: goc.id, cauHoi, phien: '', lichSu }, LUAT_NHAP_SAN[kenh.platform])
    return { ...kq, khoKienThuc: shop ? shop.ten : null }
}

/** Gửi kết quả ra webhook đầu ra của shop (nếu đã cài) — kèm lại các trường của tin vào */
async function guiKetQuaRa(shop: DongShopChatbot, tin: TinNhanWebhook, kq: KetQuaTin, body: unknown): Promise<KetQuaDauRa | null> {
    if (!shop.webhookRa || !shop.webhookRaKhoa) return null
    return guiDauRa(shop.webhookRa, shop.webhookRaKhoa, taoGoiDauRa({
        shop: kq.shop, sessionId: kq.phien, cauHoi: tin.cauHoi, traLoi: kq.traLoi, canNhanVien: kq.canNhanVien,
        sanPham: kq.sanPham, kemTheo: kemTheo(body), ...(kq.loi ? { loi: kq.loi } : {}),
    }))
}

/** Cấu hình webhook của shop cho trang quản lý (chỉ JWT quản lý mới thấy) */
function cauHinhWebhook(req: AuthRequest, s: DongShopChatbot) {
    return { duongVao: duongVao(req.user?.storeCode, s.webhookToken), webhookRa: s.webhookRa || '', webhookRaKhoa: s.webhookRaKhoa || null }
}

// POST /webhook — khoá API (scope chatbot) + x-store-code, hoặc JWT (ô "Thử chatbot"). guiDauRa: true ⇒ gửi cả ra đầu ra.
router.post('/webhook', authMiddleware, requirePermission('products.view'), async (req: AuthRequest, res: Response) => {
    const tin = docTinNhan(req.body)
    if ('loi' in tin) { res.status(400).json({ success: false, error: tin.loi }); return }
    const prisma: any = req.storePrisma!
    try {
        await damBaoBangChatbot(prisma, schemaCua(req))
        const shop = await timShopChatbot(prisma, tin.shop)
        if (!shop) {
            res.status(404).json({ success: false, error: `Không có shop "${tin.shop}" trong kengi.vn/chatbot — mở trang chatbot, chọn shop rồi chép đúng mã shop` })
            return
        }
        const kq = await xuLyTin(prisma, schemaCua(req), String(req.user?.storeCode || ''), shop, tin)
        const dauRa = req.body?.guiDauRa === true ? await guiKetQuaRa(shop, tin, kq, req.body) : null
        res.json({ success: true, data: { ...kq, ...(dauRa ? { dauRa } : {}) } })
    } catch (err: any) {
        console.error('[chatbot/webhook]', err?.message || err)
        res.status(500).json({ success: false, error: 'Chatbot lỗi hệ thống — thử lại sau' })
    }
})

// ─── ĐẦU VÀO: POST /vao/<mã cửa hàng>/<khoá> — n8n dán URL là xong ────────────────────────────────────────────
type CuaHangVao = { prisma: any; schema: string; code: string; shop: DongShopChatbot }
const SAI_DUONG_VAO = 'Đường dẫn đầu vào không đúng hoặc đã được đổi — chép lại ở kengi.vn/chatbot › Kết nối n8n'

/** Tra cửa hàng + shop theo đường dẫn. null ⇒ 404 (KHÔNG nói rõ sai mã hay sai khoá — chống dò). */
async function timTheoDuongVao(ma: string, khoa: string): Promise<CuaHangVao | null> {
    const maThuong = String(ma || '').trim().toLowerCase()
    if (!/^[a-z0-9_-]{2,40}$/.test(maThuong) || !laKhoaWebhook(khoa)) return null
    let store: any = await registryPrisma.store.findFirst({ where: { code: maThuong } })
    if (!store) {
        const ds: any[] = await registryPrisma.$queryRawUnsafe(`SELECT * FROM "Store" WHERE LOWER(code) = $1 LIMIT 1`, maThuong)
        store = ds[0] || null
    }
    if (!store?.schema || (store.status && store.status !== 'active')) return null
    const prisma: any = getStorePrisma(store.schema)
    /* KHÔNG tạo / vá bảng ở đường KHÔNG đăng nhập (người lạ đoán mã cửa hàng là bắt máy chủ chạy DDL). Bảng chưa có /
     * chưa đủ cột = chưa ai mở trang chatbot của cửa hàng ⇒ chưa có đường dẫn nào ⇒ coi như sai đường dẫn. */
    let shop: DongShopChatbot | null = null
    try { shop = await timShopTheoKhoa(prisma, khoa) } catch { return null }
    return shop ? { prisma, schema: store.schema, code: String(store.code), shop } : null
}

router.post('/vao/:ma/:khoa', async (req, res: Response) => {
    try {
        const tin = docTinNhan(req.body, false)
        if ('loi' in tin) { res.status(400).json({ success: false, error: tin.loi }); return }
        const cua = await timTheoDuongVao(String(req.params.ma), String(req.params.khoa))
        if (!cua) { res.status(404).json({ success: false, error: SAI_DUONG_VAO }); return }
        const kq = await xuLyTin(cua.prisma, cua.schema, cua.code, cua.shop, tin)
        const dauRa = await guiKetQuaRa(cua.shop, tin, kq, req.body)
        res.json({ success: true, data: { ...kq, dauRa } })
    } catch (err: any) {
        console.error('[chatbot/vao]', err?.message || err)
        res.status(500).json({ success: false, error: 'Chatbot lỗi hệ thống — thử lại sau' })
    }
})

// Mở đường dẫn bằng trình duyệt (GET) ⇒ nói đúng / sai và cách gọi, không xử lý tin
router.get('/vao/:ma/:khoa', async (req, res: Response) => {
    try {
        const cua = await timTheoDuongVao(String(req.params.ma), String(req.params.khoa))
        if (!cua) { res.status(404).json({ success: false, error: SAI_DUONG_VAO }); return }
        res.status(405).json({
            success: false,
            error: `Đường dẫn đúng (shop "${cua.shop.ten}") — n8n cần gọi bằng POST, thân JSON {"message": "...", "sessionId": "..."}`,
        })
    } catch (err: any) {
        console.error('[chatbot/vao GET]', err?.message || err)
        res.status(500).json({ success: false, error: 'Lỗi hệ thống' })
    }
})

// ─── Cấu hình webhook của shop (trang chatbot, JWT quản lý) ────────────────────────────────────────────────
async function shopCuaQuanLy(req: AuthRequest, res: Response): Promise<DongShopChatbot | null> {
    if (!chiQuanLy(req, res)) return null
    const prisma: any = req.storePrisma!
    await damBaoBangChatbot(prisma, schemaCua(req))
    await boSungKhoaThieu(prisma)
    const shop = await timShopChatbot(prisma, String(req.params.id))
    if (!shop || shop.id !== String(req.params.id)) { res.status(404).json({ success: false, error: 'Shop chưa được lưu lên kengi.vn — tải lại trang chatbot' }); return null }
    return shop
}

// PUT /shops/:id/webhook {dauRa} — lưu URL đầu ra ('' = bỏ). Kiểm SSRF trước khi lưu.
router.put('/shops/:id/webhook', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const shop = await shopCuaQuanLy(req, res)
        if (!shop) return
        const raw = String(req.body?.dauRa ?? '').trim()
        let url: string | null = null
        if (raw) {
            const kiem = await kiemUrlDauRa(raw)
            if ('loi' in kiem) { res.status(400).json({ success: false, error: kiem.loi }); return }
            url = kiem.url
        }
        await datDauRa(req.storePrisma, shop.id, url)
        const moi = await timShopChatbot(req.storePrisma, shop.id)
        res.json({ success: true, data: cauHinhWebhook(req, moi!) })
    } catch (err: any) {
        console.error('[chatbot/webhook PUT]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không lưu được webhook đầu ra' })
    }
})

// POST /shops/:id/webhook/lam-moi {loai: 'vao' | 'ra'} — đổi khoá (link đầu vào cũ / header cũ hết dùng ngay)
router.post('/shops/:id/webhook/lam-moi', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const shop = await shopCuaQuanLy(req, res)
        if (!shop) return
        const loai = req.body?.loai === 'ra' ? 'ra' : req.body?.loai === 'vao' ? 'vao' : null
        if (!loai) { res.status(400).json({ success: false, error: 'loai phải là vao hoặc ra' }); return }
        await lamMoiKhoaWebhook(req.storePrisma, shop.id, loai)
        const moi = await timShopChatbot(req.storePrisma, shop.id)
        res.json({ success: true, data: cauHinhWebhook(req, moi!) })
    } catch (err: any) {
        console.error('[chatbot/webhook lam-moi]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không đổi được khoá' })
    }
})

// POST /shops/:id/webhook/thu — gửi một gói THỬ ra webhook đầu ra (không chạy AI)
router.post('/shops/:id/webhook/thu', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const shop = await shopCuaQuanLy(req, res)
        if (!shop) return
        if (!shop.webhookRa || !shop.webhookRaKhoa) { res.status(400).json({ success: false, error: 'Shop chưa có webhook đầu ra — dán URL rồi bấm Lưu trước' }); return }
        const kq = await guiDauRa(shop.webhookRa, shop.webhookRaKhoa, taoGoiDauRa({
            suKien: 'chatbot.thu', shop: { id: shop.id, ten: shop.ten }, sessionId: 'thu-kengi', cauHoi: 'Tin thử từ kengi.vn',
            traLoi: 'Dạ đây là tin THỬ từ kengi.vn/chatbot — webhook đầu ra đã nối đúng ạ.', canNhanVien: false, sanPham: [],
            kemTheo: { senderId: 'thu' },
        }))
        res.json({ success: true, data: kq })
    } catch (err: any) {
        console.error('[chatbot/webhook thu]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không gửi thử được' })
    }
})

export default router
