// ─────────────────────────────────────────────────────────────────────────────
//  /api/chatbot — DỮ LIỆU SẢN PHẨM CHO CHATBOT (AI Agent n8n trả lời khách), 20/10/2026.
//  Chủ shop: "giá và sản phẩm lấy từ data đã có chứ" ⇒ kho kiến thức kengi.vn/chatbot không bắt gõ tay sản phẩm / giá;
//  Agent gọi công cụ tra_cuu_san_pham → GET /san-pham ⇒ giá & tình trạng luôn MỚI.
//
//  Xác thực: JWT (người dùng thử tra ở trang chatbot) hoặc X-API-Key + x-store-code (n8n). Khoá scope 'chatbot' CHỈ
//  gọi được /api/chatbot/* (middleware/auth.ts) — lộ khoá trong n8n cũng không đọc được khách / doanh thu / giá vốn.
//  Chỉ trả thứ được nói với khách — xem lib/chatbotSanPham.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { docThamSoSanPham, tuKhoa, cauTimListing, cauTimHang, gomSanPham, TEN_SAN } from '../lib/chatbotSanPham'

const router = Router()

// đọc kèm mỗi lượt tra — Agent hiểu đúng tình trạng ngay cả khi system prompt cũ (xem lib/chatbotSanPham.ts: tồn kho ≤ 0 không tin)
const GHI_CHU_TINH_TRANG = 'tinhTrang: con_hang / sap_het = còn hàng; het_hang = sàn đang báo hết; '
    + 'chua_ro = chưa xác nhận được — KHÔNG khẳng định còn hay hết, mời khách xem link sản phẩm hoặc chờ nhân viên kiểm tra.'

// n8n gọi theo từng tin nhắn khách — 120 lượt / phút / IP là dư, chặn vòng lặp hỏng của workflow
router.use(rateLimit({
    windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Tra cứu quá nhiều lần — thử lại sau 1 phút.' },
}))

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
        const prisma: any = req.storePrisma!
        const ts = docThamSoSanPham(req.query as any)
        const tu = tuKhoa(ts.q)
        if (!ts.ma && !tu.length) {
            return res.status(400).json({ success: false, error: 'Cần từ khoá (tên hoặc mã sản phẩm) — tham số q hoặc ma' })
        }
        let rows: any[] = []
        let ghiChu = ''
        if (ts.shop) {
            const kenh: any[] = await prisma.onlineChannel.findMany({
                where: { status: 'active', ...(ts.san ? { platform: ts.san } : {}) },
                select: { id: true, name: true, platform: true },
            })
            const cua = kenh.filter(k => String(k.name || '').replace(/\s+/g, ' ').trim().toLowerCase() === ts.shop.toLowerCase())
            if (!cua.length) {
                return res.status(404).json({ success: false, error: `Không có shop "${ts.shop}"${ts.san ? ` trên ${TEN_SAN[ts.san]}` : ''} trong kênh bán của cửa hàng` })
            }
            const { sql, tham } = cauTimListing(cua.map(k => k.id), tu, ts.ma)
            rows = await prisma.$queryRawUnsafe(sql, ...tham)
            ghiChu = `Giá đang bán trên ${Array.from(new Set(cua.map(k => TEN_SAN[String(k.platform).toLowerCase()] || k.platform))).join(', ')} của shop ${cua[0].name} — `
                + 'báo giá THEO TỪNG SÀN (giaTheoSan). gia null = tuỳ phân loại: gửi link cho khách xem. ' + GHI_CHU_TINH_TRANG
        } else {
            const { sql, tham } = cauTimHang(tu, ts.ma)
            rows = await prisma.$queryRawUnsafe(sql, ...tham)
            ghiChu = 'Giá bán lẻ tại cửa hàng. ' + GHI_CHU_TINH_TRANG
        }
        const ketQua = gomSanPham(rows, tu, ts.ma, ts.ma ? 1 : ts.limit, !!ts.ma)
        const dongBo = rows.map(r => r.dongBoLuc).filter(Boolean).map((d: any) => new Date(d).getTime()).filter(Number.isFinite)
        res.json({
            success: true,
            data: {
                ketQua,
                soKetQua: ketQua.length,
                ghiChu,
                capNhatLuc: dongBo.length ? new Date(Math.max(...dongBo)).toISOString() : null,
            },
        })
    } catch (err: any) {
        console.error('[chatbot/san-pham]', err?.message || err)
        res.status(500).json({ success: false, error: 'Không tra được sản phẩm — thử lại sau' })
    }
})

export default router
