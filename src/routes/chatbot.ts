// ─────────────────────────────────────────────────────────────────────────────
//  /api/chatbot — CHATBOT TRẢ LỜI KHÁCH (20/10/2026).
//  Chủ shop: "giá và sản phẩm lấy từ data đã có chứ" + "phần này giống như là nơi nhận webhook bên n8n để xử lý câu trả
//  lời trả lại cho n8n" ⇒ n8n chỉ chuyển tin nhắn khách tới POST /webhook; kengi.vn tự tra kho kiến thức của shop (soạn ở
//  kengi.vn/chatbot) + sản phẩm / giá thật, AI soạn câu trả lời, trả về cho n8n gửi khách.
//
//  Xác thực:
//   · /webhook, /san-pham, /kenh: X-API-Key (scope 'chatbot') + x-store-code từ n8n, hoặc JWT (thử ở trang chatbot).
//     Khoá 'chatbot' CHỈ gọi được ba đường này (lib/phamViKhoaApi.ts) — lộ khoá cũng không đọc được khách / doanh thu.
//   · /shops (đọc / sửa kho kiến thức): CHỈ JWT của quản lý — khoá API nào cũng không sửa được nội dung chatbot nói.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { docThamSoSanPham, traSanPham, LoiTraSanPham, TEN_SAN, SanPhamChatbot } from '../lib/chatbotSanPham'
import {
    kiemShopChatbot, docTinNhan, timKienThuc, soanPromptChatbot, tachCoNhanVien, layPhien, ghiPhien, homNayVN,
    TRA_LOI_DU_PHONG, TaiLieu,
} from '../lib/chatbotKienThuc'
import { damBaoBangChatbot, dsShopChatbot, timShopChatbot, luuShopChatbot, xoaShopChatbot, DongShopChatbot } from '../lib/chatbotLuuTru'
import { layKeyAi } from '../lib/keyAi'
import { chayAgent, LoiGeminiTamThoi } from '../services/aiAgentRunner'
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
        const ds = await dsShopChatbot(prisma)
        res.json({
            success: true,
            data: ds.map(s => ({
                id: s.id, ten: s.ten, kenh: s.kenh, san: s.san, thuTu: s.thuTu,
                kienThuc: (() => { try { return JSON.parse(s.kienThuc) } catch { return { schema_version: 1, documents: [] } } })(),
                capNhatBoi: s.capNhatBoi, capNhatLuc: s.updatedAt,
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
        const khoaPhien = tin.phien ? `${schemaCua(req)}:${shop.id}:${tin.phien}` : ''
        const lichSu = tin.lichSu.length ? tin.lichSu : (khoaPhien ? layPhien(khoaPhien) : [])
        const sanPham: SanPhamChatbot[] = []
        const ghiSanPham = (ds: SanPhamChatbot[]) => { for (const s of ds) if (sanPham.length < 5 && !sanPham.some(x => x.ma === s.ma && x.ten === s.ten)) sanPham.push(s) }
        const nen = { shop: { id: shop.id, ten: shop.ten }, phien: tin.phien || null }

        const kenh = await kenhCuaShop(prisma, shop)
        const key = await layKeyAi(prisma)
        if (!key.gemini && !key.deepseek) {
            res.json({ success: true, data: { ...nen, traLoi: TRA_LOI_DU_PHONG, canNhanVien: true, sanPham, congCu: [], loi: 'Cửa hàng chưa cài key AI — admin vào Cài đặt → Trợ lý AI nhập Gemini API Key' } })
            return
        }
        let kq: Awaited<ReturnType<typeof chayAgent>>
        try {
            kq = await chayAgent({
                apiKey: key.gemini,
                deepseekKey: key.deepseek,
                systemPrompt: soanPromptChatbot(shop.ten, homNayVN()),
                ctx: { prisma, scopes: 'read', storeCode: String(req.user?.storeCode || '') },
                message: tin.cauHoi,
                history: lichSu,
                maxSteps: 5,
                tools: congCuChatbot(kenh, kenh ? shop.san : '', docKienThuc(shop), ghiSanPham),
            })
        } catch (e: any) {
            // AI hỏng (quá tải / hết hạn mức / key sai) ⇒ vẫn trả câu lịch sự + cờ cần người, n8n không phải đoán
            console.warn('[chatbot/webhook] AI lỗi:', e?.message || e)
            res.json({ success: true, data: { ...nen, traLoi: TRA_LOI_DU_PHONG, canNhanVien: true, sanPham, congCu: [], loi: e instanceof LoiGeminiTamThoi ? 'AI đang quá tải / hết hạn mức — thử lại sau ít phút' : `AI lỗi: ${String(e?.message || e).slice(0, 200)}` } })
            return
        }
        // bộ chạy trả '(không có nội dung trả lời)' khi model im — KHÔNG gửi chữ đó cho khách
        const rong = kq.chamTran || !String(kq.reply || '').trim() || kq.reply === '(không có nội dung trả lời)'
        const { traLoi, canNhanVien } = rong ? { traLoi: TRA_LOI_DU_PHONG, canNhanVien: true } : tachCoNhanVien(kq.reply)
        if (khoaPhien) ghiPhien(khoaPhien, tin.cauHoi, traLoi)
        res.json({
            success: true,
            data: { ...nen, traLoi, canNhanVien, sanPham, congCu: kq.toolCalls.map(t => ({ ten: t.name, ok: t.ok })), ...(kq.doiSangDeepSeek ? { ghiChu: 'Trả lời bằng DeepSeek (Gemini quá tải / hết hạn mức)' } : {}) },
        })
    } catch (err: any) {
        console.error('[chatbot/webhook]', err?.message || err)
        res.status(500).json({ success: false, error: 'Chatbot lỗi hệ thống — thử lại sau' })
    }
})

export default router
