// ═══════════════════════════════════════════════════════════════════════════════
//  MARKETING STUDIO API  (/api/mkt/*)   — 05/09/2026
//
//  Đăng nội dung ra nhiều nền tảng. Thay cho luồng Fb* chỉ-Facebook.
//
//  RANH GIỚI AN TOÀN của cả tính năng, đừng phá:
//    · Nội dung phải được DUYỆT mới lên lịch được.
//    · SỬA NỘI DUNG LÀ MẤT DUYỆT (revision tăng, approvedRevision không còn khớp).
//      Thiếu luật này thì người ta duyệt một bài, sửa nội dung, và bài KHÁC HẲN
//      được đăng ra trang khách hàng.
//    · Bài ở trạng thái `uncertain` KHÔNG BAO GIỜ tự chạy lại — chỉ người quyết,
//      qua POST /publications/:id/quyet.
//
//  Token nền tảng KHÔNG BAO GIỜ đi ra khỏi máy chủ — mọi endpoint ở đây trả về
//  bản ghi đã lọc bỏ `accessToken`.
// ═══════════════════════════════════════════════════════════════════════════════
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { registryPrisma } from '../lib/prisma'
import { maHoa, coKhoaVault } from '../lib/maHoaKhoa'
import { goiNenTang } from '../lib/mktLoiNenTang'
import { errMsg } from '../lib/errorResponse'

const router = Router()
const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin'] as const
const NEN_TANG = ['facebook', 'instagram', 'tiktok', 'youtube'] as const

/** Bỏ token trước khi trả ra ngoài. Dùng ở MỌI đường trả tài khoản. */
const loc = (a: any) => {
    if (!a) return a
    const { accessToken, ...conLai } = a
    return { ...conLai, coToken: !!accessToken }
}

/** Bật cờ registry để worker chạm tới cửa hàng này. */
async function batCoMarketing(schema?: string) {
    if (!schema) return
    await (registryPrisma as any).store
        .updateMany({ where: { schema }, data: { hasMarketing: true } })
        .catch((e: any) => console.warn('[mkt] không bật được hasMarketing:', e?.message))
}

// ─── KÊNH ────────────────────────────────────────────────────────────────────
router.get('/accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const ds = await (req.storePrisma as any).mktAccount.findMany({ orderBy: { createdAt: 'asc' } })
        res.json({ success: true, data: ds.map(loc) })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

/**
 * Nối kênh bằng TOKEN DÁN TAY. Đường này không cần App ID/Secret của nền tảng,
 * nên dùng được ngay cả khi chưa có app riêng / chưa qua duyệt.
 *
 * Kiểm token THẬT trước khi lưu — lưu một token chết là để người ta tưởng đã nối
 * xong rồi vài ngày sau mới phát hiện chẳng bài nào lên.
 */
router.post('/accounts/connect-token', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        if (!coKhoaVault()) {
            return res.status(503).json({
                success: false, code: 'THIEU_KHOA_VAULT',
                error: 'Máy chủ chưa khai MARKETING_VAULT_KEY nên chưa lưu token an toàn được. Báo quản trị hệ thống.',
            })
        }
        const platform = String(req.body?.platform || '').trim().toLowerCase()
        const token = String(req.body?.accessToken || '').trim()
        if (!(NEN_TANG as readonly string[]).includes(platform)) {
            return res.status(400).json({ success: false, error: `Nền tảng phải là một trong: ${NEN_TANG.join(', ')}` })
        }
        if (!token) return res.status(400).json({ success: false, error: 'Thiếu accessToken.' })
        if (platform !== 'facebook') {
            return res.status(501).json({
                success: false, code: 'CHUA_HO_TRO',
                error: `Chưa chuyển xong bộ nối cho ${platform}. Hiện mới dùng được Facebook.`,
            })
        }

        // Hỏi thẳng nền tảng: token này là của ai, còn sống không.
        let info: any
        try {
            info = await goiNenTang(
                `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v21.0'}/me` +
                `?fields=id,name,category,fan_count,picture{url}`,
                token, { chiDoc: true }
            )
        } catch (e: any) {
            /* Trả NGUYÊN VĂN lý do nền tảng từ chối — đây là thứ người dùng cần để
             * sửa, và là thứ hay bị `errMsg()` nuốt thành "Internal server error". */
            return res.status(400).json({
                success: false, code: 'TOKEN_KHONG_DUNG',
                error: `Token không dùng được: ${e?.message || 'nền tảng từ chối'}`,
            })
        }
        if (!info?.id) {
            return res.status(400).json({ success: false, error: 'Nền tảng không trả về id kênh cho token này.' })
        }

        const prisma: any = req.storePrisma
        const luu = {
            name: info.name || `Kênh ${info.id}`,
            category: info.category ?? null,
            avatar: info?.picture?.data?.url ?? null,
            followers: typeof info.fan_count === 'number' ? info.fan_count : null,
            accessToken: maHoa(token),
            /* Page token dán tay sống ~60 ngày và KHÔNG tự gia hạn được (không có
             * user token). Ghi hạn 55 ngày để còn kịp nhắc trước khi chết. */
            tokenExpiresAt: new Date(Date.now() + 55 * 86400_000),
            status: 'active',
            lastSyncAt: new Date(),
        }
        const acc = await prisma.mktAccount.upsert({
            where: { platform_externalId: { platform, externalId: String(info.id) } },
            create: { platform, externalId: String(info.id), connectedBy: req.user?.userId, ...luu },
            update: luu,
        })
        await batCoMarketing(req.user?.storeSchema)
        res.json({ success: true, data: loc(acc) })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

router.delete('/accounts/:id', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        await (req.storePrisma as any).mktAccount.delete({ where: { id: req.params.id as string } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── CHIẾN DỊCH ──────────────────────────────────────────────────────────────
router.get('/campaigns', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const ds = await (req.storePrisma as any).mktCampaign.findMany({ orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data: ds })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

router.post('/campaigns', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const name = String(req.body?.name || '').trim()
        if (!name) return res.status(400).json({ success: false, error: 'Thiếu tên chiến dịch.' })
        const c = await (req.storePrisma as any).mktCampaign.create({
            data: {
                name, goal: String(req.body?.goal || ''),
                startAt: req.body?.startAt ? new Date(req.body.startAt) : null,
                endAt: req.body?.endAt ? new Date(req.body.endAt) : null,
                createdBy: req.user?.userId,
            },
        })
        res.json({ success: true, data: c })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

/** Tạm dừng chiến dịch GIỮ luôn cả hàng đợi — worker thấy `paused` là hoãn. */
router.patch('/campaigns/:id', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const data: any = {}
        for (const k of ['name', 'goal', 'status'] as const) if (req.body?.[k] !== undefined) data[k] = req.body[k]
        const c = await (req.storePrisma as any).mktCampaign.update({ where: { id: req.params.id as string }, data })
        res.json({ success: true, data: c })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── NỘI DUNG ────────────────────────────────────────────────────────────────
router.get('/contents', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const where: any = {}
        if (req.query.status) where.status = String(req.query.status)
        if (req.query.campaignId) where.campaignId = String(req.query.campaignId)
        const ds = await (req.storePrisma as any).mktContent.findMany({
            where, orderBy: { updatedAt: 'desc' }, take: 200,
            include: { publications: { include: { account: { select: { platform: true, name: true } } } } },
        })
        res.json({ success: true, data: ds })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

router.post('/contents', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const body = String(req.body?.body || '').trim()
        if (!body) return res.status(400).json({ success: false, error: 'Nội dung bài không được để trống.' })
        const c = await (req.storePrisma as any).mktContent.create({
            data: {
                campaignId: req.body?.campaignId || null,
                title: String(req.body?.title || ''), body,
                hashtags: JSON.stringify(req.body?.hashtags || []),
                linkUrl: req.body?.linkUrl || null,
                productIds: JSON.stringify(req.body?.productIds || []),
                status: 'pending', source: req.body?.source === 'ai' ? 'ai' : 'manual',
                createdBy: req.user?.userId,
            },
        })
        res.json({ success: true, data: c })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

/**
 * ⛔ SỬA LÀ MẤT DUYỆT. `revision` tăng, `approvedRevision` về null.
 * Bài đang chờ trong hàng đợi sẽ bị worker từ chối (khoá "CHUA_DUYET") thay vì
 * đăng bản cũ — đó là điều đúng: người duyệt đã duyệt CHỮ KHÁC.
 */
router.patch('/contents/:id', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const id = req.params.id as string
        const cu = await prisma.mktContent.findUnique({ where: { id } })
        if (!cu) return res.status(404).json({ success: false, error: 'Không tìm thấy nội dung.' })

        const data: any = {}
        for (const k of ['title', 'body', 'linkUrl'] as const) if (req.body?.[k] !== undefined) data[k] = req.body[k]
        if (req.body?.hashtags !== undefined) data.hashtags = JSON.stringify(req.body.hashtags)

        const doiChu = ['title', 'body', 'linkUrl', 'hashtags'].some(k => data[k] !== undefined && data[k] !== (cu as any)[k])
        if (doiChu) {
            data.revision = cu.revision + 1
            data.approvedRevision = null
            data.approvedAt = null
            data.approvedBy = null
            if (cu.status === 'approved' || cu.status === 'scheduled') data.status = 'pending'
        }
        const c = await prisma.mktContent.update({ where: { id }, data })
        res.json({ success: true, data: c, matDuyet: doiChu && cu.approvedRevision !== null })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

router.post('/contents/:id/approve', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const c = await prisma.mktContent.findUnique({ where: { id: req.params.id as string } })
        if (!c) return res.status(404).json({ success: false, error: 'Không tìm thấy nội dung.' })
        const kq = await prisma.mktContent.update({
            where: { id: c.id },
            data: {
                approvedRevision: c.revision, approvedAt: new Date(),
                approvedBy: req.user?.userId, status: 'approved', rejectReason: null,
            },
        })
        res.json({ success: true, data: kq })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

router.post('/contents/:id/reject', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const kq = await (req.storePrisma as any).mktContent.update({
            where: { id: req.params.id as string },
            data: { status: 'rejected', rejectReason: String(req.body?.reason || ''), approvedRevision: null },
        })
        res.json({ success: true, data: kq })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── LÊN LỊCH ────────────────────────────────────────────────────────────────
/**
 * Tạo một `MktPublication` cho MỖI kênh được chọn. Mỗi kênh một dòng riêng nên
 * kênh này hỏng không kéo kênh kia hỏng theo.
 *
 * `idempotencyKey` gồm cả revision: gọi hai lần cùng bài + cùng kênh + cùng bản
 * thì đụng ràng buộc UNIQUE và bị bỏ qua, không đẻ bài thứ hai.
 */
router.post('/contents/:id/schedule', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const c = await prisma.mktContent.findUnique({ where: { id: req.params.id as string } })
        if (!c) return res.status(404).json({ success: false, error: 'Không tìm thấy nội dung.' })
        if (c.approvedRevision !== c.revision) {
            return res.status(409).json({
                success: false, code: 'CHUA_DUYET',
                error: 'Bài chưa được duyệt, hoặc đã sửa sau khi duyệt. Duyệt lại bản hiện tại rồi mới lên lịch.',
            })
        }
        const accountIds: string[] = Array.isArray(req.body?.accountIds) ? req.body.accountIds : []
        if (!accountIds.length) return res.status(400).json({ success: false, error: 'Chưa chọn kênh nào.' })
        const khi = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : new Date()
        if (isNaN(khi.getTime())) return res.status(400).json({ success: false, error: 'Giờ hẹn không hợp lệ.' })

        const taoRa: any[] = [], boQua: string[] = []
        for (const accId of accountIds) {
            const acc = await prisma.mktAccount.findUnique({ where: { id: accId } })
            if (!acc) { boQua.push(`${accId}: không tìm thấy kênh`); continue }
            if (acc.status !== 'active') { boQua.push(`${acc.name}: kênh đang "${acc.status}"`); continue }
            const key = `${c.id}|${accId}|${c.revision}`
            const daCo = await prisma.mktPublication.findUnique({ where: { idempotencyKey: key } })
            if (daCo) { boQua.push(`${acc.name}: đã có trong hàng đợi`); continue }
            taoRa.push(await prisma.mktPublication.create({
                data: { contentId: c.id, accountId: accId, idempotencyKey: key, scheduledAt: khi, status: 'queued' },
            }))
        }
        if (taoRa.length) {
            await prisma.mktContent.update({ where: { id: c.id }, data: { status: 'scheduled' } })
            await batCoMarketing(req.user?.storeSchema)
        }
        res.json({ success: true, data: { daTao: taoRa.length, boQua, publications: taoRa } })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

router.get('/publications', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const where: any = {}
        if (req.query.status) where.status = String(req.query.status)
        const ds = await (req.storePrisma as any).mktPublication.findMany({
            where, orderBy: { scheduledAt: 'desc' }, take: 200,
            include: {
                account: { select: { platform: true, name: true } },
                content: { select: { title: true, body: true } },
            },
        })
        res.json({ success: true, data: ds })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

router.post('/publications/:id/cancel', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        /* CHỈ huỷ được khi CHƯA gửi. Bài đang `processing` mà cho huỷ thì worker
         * vẫn gửi tiếp và ta mất dấu — điều kiện nằm TRONG câu update. */
        const kq = await (req.storePrisma as any).mktPublication.updateMany({
            where: { id: req.params.id as string, status: 'queued' },
            data: { status: 'cancelled' },
        })
        if (kq.count === 0) {
            return res.status(409).json({
                success: false, code: 'KHONG_HUY_DUOC',
                error: 'Chỉ huỷ được bài đang chờ. Bài đang gửi hoặc đã gửi thì không huỷ được ở đây.',
            })
        }
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

/**
 * ⛔ CỬA DUY NHẤT XỬ LÝ BÀI `uncertain` — và cố ý bắt NGƯỜI quyết.
 *
 * `uncertain` nghĩa là đã gửi đi mà không biết kết quả. Máy không có cách nào tự
 * biết bài đã lên hay chưa; đoán sai theo một chiều là mất bài, sai theo chiều kia
 * là đăng trùng lên trang khách hàng. Nên người phải vào nền tảng nhìn rồi nói:
 *   quyet = 'da-len'   → ghi nhận đã đăng (kèm remotePostId nếu có)
 *   quyet = 'chua-len' → cho về hàng đợi để gửi lại
 */
router.post('/publications/:id/quyet', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const id = req.params.id as string
        const quyet = String(req.body?.quyet || '')
        const p = await prisma.mktPublication.findUnique({ where: { id } })
        if (!p) return res.status(404).json({ success: false, error: 'Không tìm thấy bài.' })
        if (!['uncertain', 'failed'].includes(p.status)) {
            return res.status(409).json({ success: false, error: `Bài đang ở trạng thái "${p.status}", không cần quyết.` })
        }
        if (quyet === 'da-len') {
            const kq = await prisma.mktPublication.update({
                where: { id },
                data: {
                    status: 'sent', sentAt: p.sentAt || new Date(),
                    remotePostId: String(req.body?.remotePostId || p.remotePostId || '') || null,
                    errorCode: null, errorMessage: null,
                },
            })
            return res.json({ success: true, data: kq })
        }
        if (quyet === 'chua-len') {
            const kq = await prisma.mktPublication.update({
                where: { id },
                data: {
                    status: 'queued', scheduledAt: new Date(),
                    leaseUntil: null, workerId: null, errorCode: null, errorMessage: null,
                    /* GIỮ `remoteRef`: nếu nền tảng đã cấp container/upload id thì lần
                     * gửi lại phải DÙNG LẠI, không thì đẻ thêm một cái nữa. */
                },
            })
            return res.json({ success: true, data: kq })
        }
        res.status(400).json({ success: false, error: 'quyet phải là "da-len" hoặc "chua-len".' })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── TÌNH TRẠNG ──────────────────────────────────────────────────────────────
/** Một cửa hàng đang ở đâu — để giao diện biết cần nhắc gì. */
router.get('/tinh-trang', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const [soKenh, cho, moHo, hong, daGui] = [
            await prisma.mktAccount.count({ where: { status: 'active' } }),
            await prisma.mktPublication.count({ where: { status: 'queued' } }),
            await prisma.mktPublication.count({ where: { status: 'uncertain' } }),
            await prisma.mktPublication.count({ where: { status: 'failed' } }),
            await prisma.mktPublication.count({ where: { status: 'sent' } }),
        ]
        res.json({
            success: true,
            data: {
                soKenh, dangCho: cho, moHo, hong, daGui,
                coKhoaVault: coKhoaVault(),
                cangNhac: !coKhoaVault()
                    ? 'Máy chủ chưa khai MARKETING_VAULT_KEY — chưa nối kênh được.'
                    : soKenh === 0 ? 'Chưa nối kênh nào. Vào Kết nối kênh để dán token.'
                        : moHo > 0 ? `${moHo} bài GỬI RỒI MÀ CHƯA RÕ KẾT QUẢ — cần bạn vào nền tảng kiểm rồi quyết.`
                            : null,
            },
        })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

export default router
