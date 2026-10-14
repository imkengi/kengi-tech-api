/* ═══════════════════════════════════════════════════════════════════════════════
 *  MEDIA BÁN HÀNG › TẠO VIDEO TỪ SẢN PHẨM — /api/san-media/lam-video (14/10/2026)
 *
 *  Chọn sản phẩm (ngẫu nhiên / tìm) và chuyển ảnh cho máy dựng Frame chạy trên trình duyệt.
 *  Không ghi gì: video dựng xong đi đường tải lên sẵn có (/san-media/tai-len → POST /san-media).
 *  Lõi ở lib/lamVideoSanPham.ts.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { moTaLoi } from '../lib/gomLoi'
import { chonSanPham, demKho, chiTietLamVideo, layAnhSanPham, layAnhTrenSan, danhSachGianShopee, layLogoGian, LoiAnh, type LocChon } from '../lib/lamVideoSanPham'

const router = Router()
const QUYEN = requirePermission('online_orders.edit', 'online_orders.view')

/** Bảng SanMediaSanPham chưa có ở cửa hàng chưa chạy sync-schemas — nói đúng bệnh, không trả rỗng. */
const laThieuBang = (e: any) => /P2021|does not exist|relation .* does not exist/i.test(String(e?.code || '') + ' ' + String(e?.message || ''))

const coKhong = (v: unknown, macDinh: boolean) => v === undefined || v === '' ? macDinh : !/^(0|false|khong|no)$/i.test(String(v))

function docLoc(q: any): LocChon {
    return {
        soLuong: Number(q.soLuong) || 1,
        q: q.q ? String(q.q) : '',
        chiConHang: coKhong(q.chiConHang, true),
        chiTrenSan: coKhong(q.chiTrenSan, true),
        channelId: q.channelId ? String(q.channelId) : null,
        san: q.san ? String(q.san) : null,
        boQua: String(q.boQua || '').split(',').map(s => s.trim()).filter(Boolean),
        sapXep: q.sapXep ? String(q.sapXep) : 'ngau-nhien',
    }
}

// ─── GET /san-pham — ứng viên (mặc định ngẫu nhiên, mã chưa có video trước) + số đếm kho ──
router.get('/san-pham', authMiddleware, QUYEN, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const loc = docLoc(req.query)
        // POOL 1 ⇒ tuần tự
        const items = await chonSanPham(prisma, loc)
        const dem = await demKho(prisma, { ...loc, q: '', boQua: [] })
        res.json({ success: true, data: { items, dem } })
    } catch (e: any) {
        if (laThieuBang(e)) { res.status(503).json({ success: false, error: 'Kho media chưa có trên cửa hàng này. Chạy POST /api/admin/sync-schemas rồi thử lại.' }); return }
        console.error('[lam-video] san-pham:', e)
        res.status(500).json({ success: false, error: moTaLoi(e) })
    }
})

// ─── GET /san-pham/:id — mô tả đầy đủ + ảnh + gian đang bán + video đã có ──────
router.get('/san-pham/:id', authMiddleware, QUYEN, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const d = await chiTietLamVideo(prisma, String(req.params.id))
        if (!d) { res.status(404).json({ success: false, error: 'Không thấy sản phẩm (có thể đã gộp sang mã khác)' }); return }
        res.json({ success: true, data: d })
    } catch (e: any) {
        if (laThieuBang(e)) { res.status(503).json({ success: false, error: 'Kho media chưa có trên cửa hàng này. Chạy POST /api/admin/sync-schemas rồi thử lại.' }); return }
        console.error('[lam-video] chi-tiet:', e)
        res.status(500).json({ success: false, error: moTaLoi(e) })
    }
})

// ─── GET /anh/:anhId — byte ảnh cho canvas (bucket ảnh không bật CORS) ────────
router.get('/anh/:anhId', authMiddleware, QUYEN, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { buf, loai } = await layAnhSanPham(prisma, String(req.params.anhId))
        res.setHeader('Content-Type', loai)
        res.setHeader('Content-Length', String(buf.length))
        // Ảnh kho đặt tên ngẫu nhiên, không sửa tại chỗ ⇒ cache riêng trình duyệt được
        res.setHeader('Cache-Control', 'private, max-age=3600')
        res.end(buf)
    } catch (e: any) {
        if (e instanceof LoiAnh) { res.status(e.ma).json({ success: false, error: e.message }); return }
        console.error('[lam-video] anh:', e?.message || e)
        res.status(502).json({ success: false, error: `Không lấy được ảnh: ${moTaLoi(e)}` })
    }
})

// ─── GET /gian — các gian Shopee + logo (ảnh đại diện gian, v2.shop.get_profile) ──
//  ?lamMoi=1 bỏ bộ nhớ đệm 6 giờ (vừa đổi ảnh đại diện trên Shopee)
router.get('/gian', authMiddleware, QUYEN, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const ds = await danhSachGianShopee(prisma, String(req.query.lamMoi || '') === '1')
        res.json({ success: true, data: ds.map(g => ({ channelId: g.channelId, ten: g.ten, tenShop: g.tenShop, coLogo: !!g.logo, loi: g.loi })) })
    } catch (e: any) {
        console.error('[lam-video] gian:', e)
        res.status(500).json({ success: false, error: moTaLoi(e) })
    }
})

// ─── GET /gian/:channelId/logo — byte logo gian cho máy dựng ──────────────────
router.get('/gian/:channelId/logo', authMiddleware, QUYEN, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { buf, loai } = await layLogoGian(prisma, String(req.params.channelId))
        res.setHeader('Content-Type', loai)
        res.setHeader('Content-Length', String(buf.length))
        res.setHeader('Cache-Control', 'private, max-age=3600')
        res.end(buf)
    } catch (e: any) {
        if (e instanceof LoiAnh) { res.status(e.ma).json({ success: false, error: e.message }); return }
        console.error('[lam-video] logo gian:', e?.message || e)
        res.status(502).json({ success: false, error: `Không lấy được logo gian: ${moTaLoi(e)}` })
    }
})

// ─── GET /anh-san/:id — ảnh chính listing trên sàn (poster 1024×1024) cho máy dựng ──
router.get('/anh-san/:id', authMiddleware, QUYEN, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { buf, loai } = await layAnhTrenSan(prisma, String(req.params.id))
        res.setHeader('Content-Type', loai)
        res.setHeader('Content-Length', String(buf.length))
        res.setHeader('Cache-Control', 'private, max-age=3600')
        res.end(buf)
    } catch (e: any) {
        if (e instanceof LoiAnh) { res.status(e.ma).json({ success: false, error: e.message }); return }
        console.error('[lam-video] anh-san:', e?.message || e)
        res.status(502).json({ success: false, error: `Không lấy được ảnh trên sàn: ${moTaLoi(e)}` })
    }
})

export default router
