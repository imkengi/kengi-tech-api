// ═══════════════════════════════════════════════════════════════════════════════
//  AI MARKETING API  (/api/marketing/*)
//  Màn "Content AI" của kengi.vn/fanpage-manager gọi các endpoint này.
//
//  Luồng: chủ shop khai HỒ SƠ THƯƠNG HIỆU → bấm "Lên kế hoạch" → agent soạn bài
//  vào hàng đợi CHỜ DUYỆT → chủ shop đọc, sửa, DUYỆT → lúc đó bài mới thật sự
//  lên lịch trên Facebook. Đây là ranh giới an toàn của cả tính năng: agent
//  không có đường nào tự đẩy nội dung ra ngoài.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { FacebookService, FbGraphError } from '../services/platforms/facebook'
import { chayLenContent, DANH_SACH_TOOL } from '../services/marketingAgent'
import { PILLARS } from './mcpMarketingTools'
import { ToolCtx } from '../lib/mcpTypes'

const router = Router()

const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin'] as const
const VN_OFFSET_MS = 7 * 60 * 60 * 1000

/** Nhãn tiếng Việt của trụ nội dung — FE và báo cáo dùng chung một bảng. */
export const NHAN_PILLAR: Record<string, { ten: string; mau: string; y: string }> = {
    'giao-duc': { ten: 'Giáo dục', mau: '#38bdf8', y: 'Mẹo dùng, cách chọn, giải đáp hiểu lầm — nuôi lòng tin' },
    'san-pham': { ten: 'Sản phẩm', mau: '#a78bfa', y: 'Giới thiệu mặt hàng cụ thể, giải quyết vấn đề gì' },
    'khuyen-mai': { ten: 'Khuyến mãi', mau: '#f472b6', y: 'Deal, combo, giảm giá đang chạy thật' },
    'chung-thuc': { ten: 'Chứng thực', mau: '#34d399', y: 'Phản hồi khách, số liệu bán thật' },
    'hau-truong': { ten: 'Hậu trường', mau: '#fbbf24', y: 'Chuyện shop, đóng gói, người thật việc thật' },
    'tuong-tac': { ten: 'Tương tác', mau: '#60a5fa', y: 'Hỏi mở, bình chọn — kéo bình luận' },
    'xu-huong': { ten: 'Xu hướng', mau: '#fb923c', y: 'Lễ tết, mùa vụ, sự kiện đang nóng' },
    'khac': { ten: 'Khác', mau: '#94a3b8', y: '' },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonMang(raw: any): any[] {
    if (Array.isArray(raw)) return raw
    try { const v = JSON.parse(String(raw || '[]')); return Array.isArray(v) ? v : [] } catch { return [] }
}
function jsonObj(raw: any): Record<string, any> {
    try { const v = JSON.parse(String(raw || '{}')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}

/** Bảng lỗi Graph → HTTP, giống routes/fanpage.ts để FE xử lý một kiểu. */
function sendGraphError(res: Response, err: any) {
    const g = err as FbGraphError
    if (g?.isTokenError) return res.status(401).json({ success: false, error: g.message, code: 'FB_TOKEN_EXPIRED' })
    console.error('[Marketing] Graph error:', g?.message)
    return res.status(502).json({ success: false, error: g?.message || 'Facebook error', code: g?.code })
}

/** Page mặc định khi FE không truyền pageId (đa số shop chỉ có 1 page). */
async function pageMacDinh(prisma: any, pageId?: string): Promise<any | null> {
    const where: any = { status: { not: 'disconnected' } }
    if (pageId) return prisma.fbPage.findFirst({ where: { ...where, pageId: String(pageId) } })
    return prisma.fbPage.findFirst({ where, orderBy: { createdAt: 'asc' } })
}

/** Hồ sơ thương hiệu là singleton của store. */
async function layHoSo(prisma: any) {
    return prisma.fbBrandProfile.findFirst({ orderBy: { createdAt: 'asc' } })
}

/** Đổi bản ghi draft sang shape FE dùng (đã bung JSON, đã có nhãn tiếng Việt). */
function doiRaDraft(d: any) {
    return {
        id: d.id,
        planId: d.planId,
        pageId: d.pageId,
        pillar: d.pillar,
        pillarTen: (NHAN_PILLAR[d.pillar] || NHAN_PILLAR.khac).ten,
        pillarMau: (NHAN_PILLAR[d.pillar] || NHAN_PILLAR.khac).mau,
        title: d.title,
        hook: d.hook,
        message: d.message,
        hashtags: jsonMang(d.hashtags),
        mediaIdea: d.mediaIdea,
        mediaUrls: jsonMang(d.mediaUrls),
        linkUrl: d.linkUrl,
        productIds: jsonMang(d.productIds),
        suggestedAt: d.suggestedAt,
        status: d.status,
        rejectReason: d.rejectReason,
        scheduledPostId: d.scheduledPostId,
        fbPostId: d.fbPostId,
        source: d.source,
        createdAt: d.createdAt,
    }
}

/**
 * Văn bản CUỐI CÙNG đem đăng = nội dung + dòng hashtag.
 * Hashtag lưu riêng để chủ shop sửa nội dung mà không phải né chuỗi #; ghép ở
 * đây, ngay trước khi gửi Facebook, là chỗ duy nhất biết bài sắp đăng thật.
 */
function ghepBaiDang(message: string, hashtags: string[]): string {
    const tag = (hashtags || []).map(h => '#' + String(h).replace(/^#/, '').replace(/\s+/g, '')).filter(t => t.length > 1)
    return tag.length ? `${message.trim()}\n\n${tag.join(' ')}` : message.trim()
}

/** Đọc chuỗi giờ FE gửi. Không kèm múi giờ = GIỜ VN (đồng bộ với toàn hệ fanpage). */
function docGioVN(raw: any): number | null {
    const s = String(raw || '').trim()
    if (!s) return null
    const coMuiGio = /(Z|[+-]\d{2}:?\d{2})$/i.test(s)
    const chuan = s.includes('T') ? s : s.replace(' ', 'T')
    const ms = new Date(coMuiGio ? chuan : `${chuan}${chuan.length === 16 ? ':00' : ''}+07:00`).getTime()
    return Number.isFinite(ms) ? ms : null
}

/** Bảng chưa migrate → trả rỗng êm thay vì 500 (store cũ chưa chạy /admin/migrate). */
function laChuaMigrate(e: any): boolean {
    return /does not exist|FbBrandProfile|FbContentPlan|FbContentDraft/i.test(e?.message || '')
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HỒ SƠ THƯƠNG HIỆU
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/marketing/brand
router.get('/brand', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const h = await layHoSo(req.storePrisma!)
        res.json({
            success: true,
            data: h ? {
                ...h,
                hashtags: jsonMang(h.hashtags),
                bannedWords: jsonMang(h.bannedWords),
                bestHours: jsonMang(h.bestHours),
                pillarMix: jsonObj(h.pillarMix),
            } : null,
            pillars: PILLARS.map(p => ({ key: p, ...NHAN_PILLAR[p] })),
        })
    } catch (e: any) {
        if (laChuaMigrate(e)) {
            return res.json({ success: true, data: null, canhBao: 'Bảng marketing chưa được tạo — chạy /admin/migrate.' })
        }
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/marketing/brand — tạo nếu chưa có, cập nhật nếu đã có
router.put('/brand', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const data: any = {}
        if (typeof b.brandName === 'string') data.brandName = b.brandName.trim()
        if (typeof b.industry === 'string') data.industry = b.industry.trim()
        if (typeof b.audience === 'string') data.audience = b.audience.trim()
        if (['than-thien', 'chuyen-nghiep', 'hai-huoc', 'sang-trong'].includes(String(b.toneOfVoice))) data.toneOfVoice = String(b.toneOfVoice)
        if (typeof b.usp === 'string') data.usp = b.usp.trim()
        if (typeof b.cta === 'string') data.cta = b.cta.trim()
        if (['khong', 'vua', 'nhieu'].includes(String(b.emojiLevel))) data.emojiLevel = String(b.emojiLevel)
        if (typeof b.notes === 'string') data.notes = b.notes.trim()
        if (b.postsPerWeek !== undefined) data.postsPerWeek = Math.min(Math.max(Number(b.postsPerWeek) || 5, 1), 21)
        if (Array.isArray(b.hashtags)) data.hashtags = JSON.stringify(b.hashtags.map((x: any) => String(x).replace(/^#/, '').trim()).filter(Boolean).slice(0, 15))
        if (Array.isArray(b.bannedWords)) data.bannedWords = JSON.stringify(b.bannedWords.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 50))
        if (Array.isArray(b.bestHours)) {
            const gio = [...new Set(b.bestHours.map((h: any) => Math.min(Math.max(Number(h) || 0, 0), 23)))].sort((x: any, y: any) => x - y)
            data.bestHours = JSON.stringify(gio)
        }
        if (b.pillarMix && typeof b.pillarMix === 'object' && !Array.isArray(b.pillarMix)) {
            const mix: Record<string, number> = {}
            for (const [k, v] of Object.entries(b.pillarMix)) {
                if ((PILLARS as readonly string[]).includes(k) && Number(v) > 0) mix[k] = Math.min(Number(v), 20)
            }
            data.pillarMix = JSON.stringify(mix)
        }
        if (!Object.keys(data).length) return res.status(400).json({ success: false, error: 'Không có trường nào để lưu' })

        const cu = await layHoSo(prisma)
        const h = cu
            ? await prisma.fbBrandProfile.update({ where: { id: cu.id }, data })
            : await prisma.fbBrandProfile.create({ data: { ...data, createdBy: req.user?.userId } })
        res.json({
            success: true,
            data: { ...h, hashtags: jsonMang(h.hashtags), bannedWords: jsonMang(h.bannedWords), bestHours: jsonMang(h.bestHours), pillarMix: jsonObj(h.pillarMix) },
        })
    } catch (e: any) {
        if (laChuaMigrate(e)) return res.status(503).json({ success: false, error: 'Bảng marketing chưa được tạo — chạy /admin/migrate trước.' })
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  KẾ HOẠCH NỘI DUNG
//
//  ⚠ ĐANG THAY THẾ (05/09/2026) — luồng nội dung dưới đây (FbContentPlan /
//  FbContentDraft / FbScheduledPost) chỉ chạy được với Facebook và KHÔNG có khoá
//  idempotent, không giành việc nguyên tử, không xử lý "ghi mơ hồ". Bản thay thế
//  là `/api/mkt/*` (bảng Mkt*), chạy được 4 nền tảng và có đủ ba thứ đó.
//
//  CHƯA XOÁ, và cố ý chưa xoá: giao diện fanpage-manager hiện tại còn gọi các
//  đường này. Đo 05/09/2026: bảng Fb* RỖNG ở cả 11 cửa hàng (POST
//  /admin/chuyen-marketing chạy thử ra 0 bản ghi), nên không có dữ liệu nào mắc
//  kẹt ở đây — xoá được ngay khi giao diện mới lên thay.
//
//  ⛔ ĐỪNG THÊM TÍNH NĂNG MỚI VÀO ĐÂY. Thêm vào `/api/mkt/*`.
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/marketing/plans?pageId=
router.get('/plans', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const page = await pageMacDinh(prisma, req.query.pageId as string)
        if (!page) return res.json({ success: true, data: [] })
        const plans = await prisma.fbContentPlan.findMany({
            where: { pageId: page.pageId },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Number(req.query.limit) || 20, 100),
            include: { drafts: { select: { status: true } } },
        })
        res.json({
            success: true,
            data: plans.map((p: any) => {
                const dem: Record<string, number> = {}
                for (const d of p.drafts) dem[d.status] = (dem[d.status] || 0) + 1
                return { ...p, drafts: undefined, soBai: p.drafts.length, theoTrangThai: dem }
            }),
        })
    } catch (e: any) {
        if (laChuaMigrate(e)) return res.json({ success: true, data: [], canhBao: 'Bảng marketing chưa được tạo — chạy /admin/migrate.' })
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/marketing/plans/:id — xoá kế hoạch, bài nháp còn lại thành bài lẻ
router.delete('/plans/:id', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        await req.storePrisma!.fbContentPlan.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch { res.status(404).json({ success: false, error: 'Không tìm thấy kế hoạch' }) }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  HÀNG ĐỢI BÀI NHÁP
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/marketing/drafts?status=pending&pageId=&planId=
router.get('/drafts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const page = await pageMacDinh(prisma, req.query.pageId as string)
        if (!page) return res.json({ success: true, data: [], chuaKetNoiPage: true })
        const st = String(req.query.status || 'pending')
        const rows = await prisma.fbContentDraft.findMany({
            where: {
                pageId: page.pageId,
                ...(st === 'all' ? {} : { status: st }),
                ...(req.query.planId ? { planId: String(req.query.planId) } : {}),
            },
            orderBy: [{ suggestedAt: 'asc' }, { createdAt: 'desc' }],
            take: Math.min(Number(req.query.limit) || 100, 200),
        })
        // Đếm theo trạng thái để FE hiện badge mà không phải gọi thêm lượt nữa
        const dem = await prisma.fbContentDraft.groupBy({
            by: ['status'], where: { pageId: page.pageId }, _count: true,
        }).catch(() => [] as any[])
        res.json({
            success: true,
            data: rows.map(doiRaDraft),
            page: { pageId: page.pageId, name: page.name, status: page.status },
            demTheoTrangThai: Object.fromEntries((dem as any[]).map((d: any) => [d.status, d._count])),
        })
    } catch (e: any) {
        if (laChuaMigrate(e)) return res.json({ success: true, data: [], canhBao: 'Bảng marketing chưa được tạo — chạy /admin/migrate.' })
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/marketing/drafts — chủ shop tự thêm bài nháp (không qua AI)
router.post('/drafts', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const message = String(b.message || '').trim()
        if (!message) return res.status(400).json({ success: false, error: 'Nội dung bài không được để trống' })
        const page = await pageMacDinh(prisma, b.pageId)
        if (!page) return res.status(400).json({ success: false, error: 'Chưa kết nối fanpage nào' })

        const draft = await prisma.fbContentDraft.create({
            data: {
                pageId: page.pageId,
                planId: b.planId ? String(b.planId) : null,
                pillar: (PILLARS as readonly string[]).includes(String(b.pillar)) ? String(b.pillar) : 'khac',
                title: String(b.title || '').trim().slice(0, 120),
                hook: String(b.hook || '').trim(),
                message,
                hashtags: JSON.stringify(Array.isArray(b.hashtags) ? b.hashtags.map((h: any) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10) : []),
                mediaIdea: String(b.mediaIdea || '').trim(),
                mediaUrls: JSON.stringify(Array.isArray(b.mediaUrls) ? b.mediaUrls.filter((u: any) => /^https?:\/\//i.test(String(u))).slice(0, 10) : []),
                linkUrl: b.linkUrl ? String(b.linkUrl) : null,
                suggestedAt: docGioVN(b.suggestedAt) ? new Date(docGioVN(b.suggestedAt)!) : null,
                status: 'pending', source: 'manual', createdBy: req.user?.userId,
            },
        })
        res.json({ success: true, data: doiRaDraft(draft) })
    } catch (e: any) {
        if (laChuaMigrate(e)) return res.status(503).json({ success: false, error: 'Bảng marketing chưa được tạo — chạy /admin/migrate trước.' })
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PATCH /api/marketing/drafts/:id — chủ shop sửa bài trước khi duyệt
router.patch('/drafts/:id', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const cu = await prisma.fbContentDraft.findUnique({ where: { id: String(req.params.id) } })
        if (!cu) return res.status(404).json({ success: false, error: 'Không tìm thấy bài nháp' })
        if (cu.status !== 'pending') {
            return res.status(400).json({ success: false, error: `Bài đang ở trạng thái "${cu.status}" — chỉ sửa được bài còn chờ duyệt.` })
        }
        const b = req.body || {}
        const data: any = {}
        if (typeof b.message === 'string' && b.message.trim()) data.message = b.message.trim()
        if (typeof b.title === 'string') data.title = b.title.trim().slice(0, 120)
        if (typeof b.hook === 'string') data.hook = b.hook.trim()
        if (typeof b.mediaIdea === 'string') data.mediaIdea = b.mediaIdea.trim()
        if (typeof b.linkUrl === 'string') data.linkUrl = b.linkUrl.trim() || null
        if ((PILLARS as readonly string[]).includes(String(b.pillar))) data.pillar = String(b.pillar)
        if (Array.isArray(b.hashtags)) data.hashtags = JSON.stringify(b.hashtags.map((h: any) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10))
        if (Array.isArray(b.mediaUrls)) data.mediaUrls = JSON.stringify(b.mediaUrls.filter((u: any) => /^https?:\/\//i.test(String(u))).slice(0, 10))
        if (b.suggestedAt !== undefined) {
            const ms = docGioVN(b.suggestedAt)
            if (b.suggestedAt && ms === null) return res.status(400).json({ success: false, error: 'Giờ đề xuất không hợp lệ' })
            data.suggestedAt = ms ? new Date(ms) : null
        }
        if (!Object.keys(data).length) return res.status(400).json({ success: false, error: 'Không có trường nào để cập nhật' })
        const moi = await prisma.fbContentDraft.update({ where: { id: cu.id }, data })
        res.json({ success: true, data: doiRaDraft(moi) })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/marketing/drafts/:id
router.delete('/drafts/:id', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const d = await req.storePrisma!.fbContentDraft.findUnique({ where: { id: String(req.params.id) } })
        if (!d) return res.status(404).json({ success: false, error: 'Không tìm thấy bài nháp' })
        if (d.status === 'scheduled') {
            return res.status(400).json({ success: false, error: 'Bài đã lên lịch trên Facebook — huỷ ở mục Bài đã lên lịch trước, rồi mới xoá được ở đây.' })
        }
        await req.storePrisma!.fbContentDraft.delete({ where: { id: d.id } })
        res.json({ success: true })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/marketing/drafts/:id/reject  { reason? }
router.post('/drafts/:id/reject', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const d = await prisma.fbContentDraft.findUnique({ where: { id: String(req.params.id) } })
        if (!d) return res.status(404).json({ success: false, error: 'Không tìm thấy bài nháp' })
        if (d.status !== 'pending') return res.status(400).json({ success: false, error: `Bài đang ở trạng thái "${d.status}"` })
        // Giữ lại bài bị từ chối (không xoá): agent đọc được ở marketing_list_drafts
        // để lần sau không viết lại đúng kiểu chủ shop vừa bỏ.
        const moi = await prisma.fbContentDraft.update({
            where: { id: d.id },
            data: { status: 'rejected', rejectReason: String(req.body?.reason || '').trim().slice(0, 500) || null },
        })
        res.json({ success: true, data: doiRaDraft(moi) })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

/**
 * DUYỆT một bài: đây là chỗ DUY NHẤT nội dung do AI soạn đi ra ngoài Facebook.
 * Trả về bản ghi FbScheduledPost để FE hiển thị chung với các bài lên lịch khác.
 */
async function duyetMotBai(prisma: any, draft: any, userId: string | undefined, scheduledAtMs: number | null) {
    const page = await prisma.fbPage.findUnique({ where: { pageId: draft.pageId } })
    if (!page) throw Object.assign(new Error('Fanpage không còn kết nối'), { httpCode: 400 })
    if (page.status === 'token_expired') {
        throw Object.assign(new Error('Token Facebook đã hết hạn — kết nối lại fanpage rồi duyệt.'), { httpCode: 401 })
    }

    const mediaUrls = jsonMang(draft.mediaUrls).filter((u: any) => /^https?:\/\//i.test(String(u)))
    const mediaType = mediaUrls.length > 1 ? 'multi_photo' : mediaUrls.length === 1 ? 'photo' : draft.linkUrl ? 'link' : 'text'
    const message = ghepBaiDang(draft.message, jsonMang(draft.hashtags))

    const svc = new FacebookService(page.accessToken)
    const fb = await svc.createOrSchedulePost({
        pageId: page.pageId, message, mediaType, mediaUrls,
        linkUrl: draft.linkUrl || undefined, scheduledAtMs,
    })

    const rec = await prisma.fbScheduledPost.create({
        data: {
            pageId: page.pageId, fbPostId: fb.id, message,
            mediaType, mediaUrls: JSON.stringify(mediaUrls), linkUrl: draft.linkUrl || null,
            scheduledAt: scheduledAtMs ? new Date(scheduledAtMs) : new Date(),
            status: scheduledAtMs ? 'scheduled' : 'published',
            publishedAt: scheduledAtMs ? null : new Date(),
            createdBy: userId || null,
        },
    })
    await prisma.fbContentDraft.update({
        where: { id: draft.id },
        data: {
            status: scheduledAtMs ? 'scheduled' : 'published',
            scheduledPostId: rec.id, fbPostId: fb.id, rejectReason: null,
        },
    })
    return rec
}

// POST /api/marketing/drafts/:id/approve  { scheduledAt?, publishNow? }
router.post('/drafts/:id/approve', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const d = await prisma.fbContentDraft.findUnique({ where: { id: String(req.params.id) } })
        if (!d) return res.status(404).json({ success: false, error: 'Không tìm thấy bài nháp' })
        if (d.status !== 'pending' && d.status !== 'rejected') {
            return res.status(400).json({ success: false, error: `Bài đang ở trạng thái "${d.status}" — không duyệt lại được.` })
        }

        // Đăng ngay hay hẹn giờ. Hẹn giờ phải cách hiện tại ≥10 phút (quy định FB);
        // giờ agent đề xuất có thể đã trôi qua nếu chủ shop để hàng đợi lâu ngày.
        let scheduledAtMs: number | null = null
        if (!req.body?.publishNow) {
            scheduledAtMs = docGioVN(req.body?.scheduledAt) ?? (d.suggestedAt ? new Date(d.suggestedAt).getTime() : null)
            if (!scheduledAtMs) {
                return res.status(400).json({ success: false, error: 'Bài chưa có giờ đăng — chọn giờ hoặc bấm "Đăng ngay".', code: 'THIEU_GIO' })
            }
            if (scheduledAtMs < Date.now() + 10 * 60_000) {
                const vn = new Date(scheduledAtMs + VN_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16)
                return res.status(400).json({
                    success: false,
                    error: `Giờ hẹn (${vn} giờ VN) đã qua hoặc cách hiện tại dưới 10 phút — Facebook không nhận. Chọn giờ khác hoặc bấm "Đăng ngay".`,
                    code: 'GIO_DA_QUA',
                })
            }
        }

        const rec = await duyetMotBai(prisma, d, req.user?.userId, scheduledAtMs)
        res.json({ success: true, data: rec, ketQua: scheduledAtMs ? 'Đã duyệt và lên lịch đăng' : 'Đã duyệt và đăng ngay' })
    } catch (e: any) {
        if (e?.httpCode) return res.status(e.httpCode).json({ success: false, error: e.message })
        if ((e as FbGraphError)?.isTokenError || (e as FbGraphError)?.code) return sendGraphError(res, e)
        console.error('[Marketing] duyệt bài lỗi:', e?.message)
        res.status(500).json({ success: false, error: e?.message || 'Internal server error' })
    }
})

// POST /api/marketing/drafts/approve-all  { pageId?, planId? }
// Duyệt hàng loạt các bài ĐÃ CÓ giờ đề xuất còn hợp lệ. Bài thiếu giờ hoặc giờ
// đã trôi qua thì BỎ QUA và báo lại — không tự ý đổi giờ hộ chủ shop.
router.post('/drafts/approve-all', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const page = await pageMacDinh(prisma, req.body?.pageId)
        if (!page) return res.status(400).json({ success: false, error: 'Chưa kết nối fanpage nào' })

        const rows = await prisma.fbContentDraft.findMany({
            where: { pageId: page.pageId, status: 'pending', ...(req.body?.planId ? { planId: String(req.body.planId) } : {}) },
            orderBy: { suggestedAt: 'asc' },
            take: 50,
        })
        if (!rows.length) return res.json({ success: true, data: { daDuyet: 0, boQua: [], ghiChu: 'Không có bài nào chờ duyệt.' } })

        const nguong = Date.now() + 10 * 60_000
        let daDuyet = 0
        const boQua: { id: string; title: string; lyDo: string }[] = []
        // Tuần tự có chủ ý: mỗi lượt là một request lên Graph, bắn song song vừa
        // dễ dính rate limit vừa làm cạn kết nối Prisma của store.
        for (const d of rows) {
            const ms = d.suggestedAt ? new Date(d.suggestedAt).getTime() : null
            if (!ms) { boQua.push({ id: d.id, title: d.title || d.message.slice(0, 40), lyDo: 'chưa có giờ đăng' }); continue }
            if (ms < nguong) { boQua.push({ id: d.id, title: d.title || d.message.slice(0, 40), lyDo: 'giờ hẹn đã qua' }); continue }
            try {
                await duyetMotBai(prisma, d, req.user?.userId, ms)
                daDuyet++
            } catch (e: any) {
                boQua.push({ id: d.id, title: d.title || d.message.slice(0, 40), lyDo: e?.message || 'lỗi khi đăng' })
                // Token hỏng thì các bài sau cũng hỏng — dừng sớm, đừng đập Graph 50 lần
                if ((e as FbGraphError)?.isTokenError) break
            }
        }
        res.json({ success: true, data: { daDuyet, boQua, tong: rows.length } })
    } catch (e: any) {
        console.error('[Marketing] duyệt hàng loạt lỗi:', e?.message)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  CHẠY AGENT LÊN CONTENT
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/marketing/generate  { pageId?, soBai?, soNgay?, yeuCau? }
// Chạy ĐỒNG BỘ (chủ shop bấm nút và ngồi đợi). Có thể mất 30-90 giây vì agent
// đọc dữ liệu rồi viết từng bài — FE phải nới timeout, đừng để 15s cắt ngang.
router.post('/generate', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    const prisma = req.storePrisma
    if (!prisma) return res.status(401).json({ success: false, error: 'Chưa xác thực store' })

    try {
        const page = await pageMacDinh(prisma, req.body?.pageId)
        if (!page) return res.status(400).json({ success: false, error: 'Chưa kết nối fanpage nào — vào mục Kết nối để nối fanpage trước.' })
        if (page.status === 'token_expired') {
            return res.status(401).json({ success: false, error: 'Token Facebook hết hạn — kết nối lại fanpage trước khi lên content.', code: 'FB_TOKEN_EXPIRED' })
        }

        // Key Gemini riêng từng cửa hàng (Cài đặt → Trợ lý AI) → fallback env
        let apiKey = process.env.GEMINI_API_KEY || ''
        try {
            const s = await prisma.storeSettings.findFirst({ select: { geminiApiKey: true } as any }) as any
            if (s?.geminiApiKey) apiKey = s.geminiApiKey
        } catch { /* cột chưa migrate → dùng env */ }
        if (!apiKey) {
            return res.status(503).json({
                success: false,
                error: 'Chưa cấu hình Gemini API Key — vào kengi.vn → Cài đặt → Trợ lý AI để nhập (chỉ admin).',
            })
        }

        const ctx: ToolCtx = {
            prisma,
            scopes: 'read,write',
            storeCode: String(req.user?.storeCode || ''),
            userId: req.user?.userId,
            userName: (req.user as any)?.name || 'Trợ lý content',
            branchId: req.user?.branchId ?? null,
        }

        const truoc = await prisma.fbContentDraft.count({ where: { pageId: page.pageId } }).catch(() => 0)
        const kq = await chayLenContent({
            apiKey, ctx,
            pageId: page.pageId,
            soBai: Number(req.body?.soBai) || 7,
            soNgay: Number(req.body?.soNgay) || 7,
            yeuCau: String(req.body?.yeuCau || ''),
        })
        const sau = await prisma.fbContentDraft.count({ where: { pageId: page.pageId } }).catch(() => 0)

        res.json({
            success: true,
            data: {
                baoCao: kq.reply,
                soBaiMoi: Math.max(0, sau - truoc),
                chamTran: kq.chamTran,
                toolCalls: kq.toolCalls.map(t => ({ name: t.name, ok: t.ok, error: t.error })),
                // Agent có thể viết được ít hơn yêu cầu khi hết bước — nói thẳng
                // thay vì để chủ shop tự đếm rồi tưởng hệ thống hỏng.
                ghiChu: kq.chamTran
                    ? 'Agent chạm giới hạn số bước nên có thể chưa soạn đủ số bài yêu cầu. Bấm lại để soạn tiếp phần còn thiếu.'
                    : null,
            },
        })
    } catch (e: any) {
        if (laChuaMigrate(e)) return res.status(503).json({ success: false, error: 'Bảng marketing chưa được tạo — chạy /admin/migrate trước.' })
        console.error('[Marketing] generate lỗi:', e?.message)
        res.status(502).json({ success: false, error: e?.message || 'Lỗi gọi trợ lý AI' })
    }
})

// GET /api/marketing/meta — bảng tra cứu cho FE (trụ nội dung, tool agent dùng)
router.get('/meta', authMiddleware, async (_req: AuthRequest, res: Response) => {
    res.json({
        success: true,
        data: {
            pillars: PILLARS.map(p => ({ key: p, ...NHAN_PILLAR[p] })),
            toolAgentDung: DANH_SACH_TOOL,
            ghiChu: 'Agent không có tool nào đăng thẳng lên Facebook — bài chỉ vào hàng đợi chờ duyệt.',
        },
    })
})

export default router
