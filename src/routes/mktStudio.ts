// ═══════════════════════════════════════════════════════════════════════════════
//  MARKETING STUDIO API  (/api/mkt/*)   — 05/09/2026, nhiều thương hiệu 29/09/2026
//
//  Đăng nội dung ra nhiều nền tảng. Thay cho luồng Fb* chỉ-Facebook.
//  Giao diện: kengi.vn/marketing (open-retail/public/marketing).
//
//  RANH GIỚI AN TOÀN của cả tính năng, đừng phá:
//    · Nội dung phải được DUYỆT mới lên lịch được.
//    · SỬA NỘI DUNG LÀ MẤT DUYỆT (revision tăng, approvedRevision không còn khớp).
//      Thiếu luật này thì người ta duyệt một bài, sửa nội dung, và bài KHÁC HẲN
//      được đăng ra trang khách hàng. Phiên bản theo kênh (`variants`) cũng tính.
//    · Bài ở trạng thái `uncertain` KHÔNG BAO GIỜ tự chạy lại — chỉ người quyết,
//      qua POST /publications/:id/quyet.
//    · MỌI thứ gắn với MỘT thương hiệu (header `x-mkt-brand`). Không route nào được
//      đọc/ghi chéo thương hiệu: AI viết cho A không được thấy dữ liệu của B.
//
//  Token nền tảng KHÔNG BAO GIỜ đi ra khỏi máy chủ — mọi endpoint ở đây trả về
//  bản ghi đã lọc bỏ `accessToken` / `refreshSecret`.
// ═══════════════════════════════════════════════════════════════════════════════
import { Router, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { registryPrisma } from '../lib/prisma'
import multer from 'multer'
import { maHoa, giaiMa, coKhoaVault } from '../lib/maHoaKhoa'
import {
    MAX_THUONG_HIEU, LoiMkt, traLoi, hoSo, kiemBanVaHoSo,
    chonThuongHieu, MktRequest,
} from '../lib/mktThuongHieu'
import { xacMinhKenh } from '../services/mktNenTangKhac'
import { keoSoLieu, danhDauHong } from '../services/mktSoLieu'
import { jsonMang, noiDungRa as noiDung, kiemPhienBan, kiemMedia, loiKhiDangLen, loiChuTheoKenh, lenLich } from '../lib/mktNoiDung'
import { TOI_DA_TAI_LEN, nhanDangMedia, luuMedia, xoaMedia, kiemUrlCongKhai } from '../lib/mktMedia'

const taiLen = multer({ storage: multer.memoryStorage(), limits: { fileSize: TOI_DA_TAI_LEN, files: 1 } })
const schemaCua = (req: MktRequest) => String(req.user?.branchSchema || req.user?.storeSchema || '')

const router = Router()
const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin'] as const
const NEN_TANG = ['facebook', 'instagram', 'threads', 'tiktok', 'youtube'] as const
/** Mọi route làm việc TRONG một thương hiệu đi qua bộ này. */
const mkt = [authMiddleware, chonThuongHieu] as const

/** Bỏ token trước khi trả ra ngoài. Dùng ở MỌI đường trả tài khoản. */
const loc = (a: any) => {
    if (!a) return a
    const { accessToken, refreshSecret, ...conLai } = a
    return { ...conLai, coToken: !!accessToken, coLamMoi: !!refreshSecret }
}

/** Bật cờ registry để worker chạm tới cửa hàng này. */
async function batCoMarketing(schema?: string) {
    if (!schema) return
    await (registryPrisma as any).store
        .updateMany({ where: { schema }, data: { hasMarketing: true } })
        .catch((e: any) => console.warn('[mkt] không bật được hasMarketing:', e?.message))
}

// ─── THƯƠNG HIỆU ─────────────────────────────────────────────────────────────
router.get('/brands', ...mkt, async (req: MktRequest, res: Response) => {
    res.json({
        success: true,
        data: (req.mktBrands || []).map(b => ({ id: b.id, name: b.name })),
        max: MAX_THUONG_HIEU,
    })
})

router.post('/brands', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const { name } = kiemBanVaHoSo({ name: String(req.body?.name ?? '') })
        if ((req.mktBrands || []).length >= MAX_THUONG_HIEU) {
            throw new LoiMkt(`Mỗi cửa hàng dùng tối đa ${MAX_THUONG_HIEU} thương hiệu. Xoá bớt một thương hiệu để thêm mới.`, 409, 'BRAND_LIMIT')
        }
        const b = await prisma.mktBrand.create({ data: { name, createdBy: req.user?.userId } })
        res.status(201).json({ success: true, data: { id: b.id, name: b.name } })
    } catch (err) { traLoi(res, err) }
})

/**
 * Xoá MỀM (archivedAt): kênh, bài, media còn nguyên trong DB, chỉ biến khỏi danh
 * sách. Không xoá được thương hiệu cuối cùng, và không xoá khi còn bài đang chờ /
 * đang gửi — xoá giữa chừng thì bài vẫn lên trang mà không còn ai thấy để quản.
 */
router.delete('/brands/:id', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const id = String(req.params.id)
        const ds = req.mktBrands || []
        if (!ds.some(b => b.id === id)) throw new LoiMkt('Không tìm thấy thương hiệu.', 404, 'BRAND_NOT_FOUND')
        if (ds.length <= 1) throw new LoiMkt('Không xoá được thương hiệu cuối cùng của cửa hàng.', 409)
        const dangChay = await prisma.mktPublication.count({
            where: { status: { in: ['queued', 'processing'] }, content: { brandId: id } },
        })
        if (dangChay) {
            throw new LoiMkt(`Thương hiệu còn ${dangChay} bài đang chờ/đang đăng. Huỷ lịch các bài đó trước khi xoá.`, 409, 'BRAND_BUSY')
        }
        await prisma.mktBrand.update({ where: { id }, data: { archivedAt: new Date() } })
        res.json({ success: true })
    } catch (err) { traLoi(res, err) }
})

router.get('/brand', ...mkt, async (req: MktRequest, res: Response) => {
    res.json({ success: true, data: hoSo(req.mktBrand) })
})

/** Cập nhật TỪNG PHẦN: trường không gửi giữ nguyên (AI sửa "products" không xoá trắng phần còn lại). */
router.put('/brand', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        /* Công tắc "AI tự duyệt" CHỈ bật/tắt được ở đây (người đăng nhập, quyền quản lý).
         * kiemBanVaHoSo từ chối trường này — nên tool MCP sửa hồ sơ không tự cấp quyền được. */
        const { aiAutoApprove, ...hoSoMoi } = req.body || {}
        const data: any = kiemBanVaHoSo(hoSoMoi)
        if (aiAutoApprove !== undefined) {
            if (typeof aiAutoApprove !== 'boolean') throw new LoiMkt('aiAutoApprove phải là true/false.')
            data.aiAutoApprove = aiAutoApprove
            console.log(`[mkt] ${req.user?.userId} ${aiAutoApprove ? 'BẬT' : 'tắt'} AI tự duyệt cho thương hiệu ${req.mktBrand.id}`)
        }
        const b = await (req.storePrisma as any).mktBrand.update({ where: { id: req.mktBrand.id }, data })
        res.json({ success: true, data: hoSo(b) })
    } catch (err) { traLoi(res, err) }
})

// ─── KÊNH ────────────────────────────────────────────────────────────────────
router.get('/accounts', ...mkt, async (req: MktRequest, res: Response) => {
    try {
        const ds = await (req.storePrisma as any).mktAccount.findMany({
            where: { brandId: req.mktBrand.id }, orderBy: { createdAt: 'asc' },
        })
        res.json({ success: true, data: ds.map(loc) })
    } catch (err) { traLoi(res, err) }
})

/**
 * Nối kênh bằng TOKEN DÁN TAY. Đường này không cần App ID/Secret của nền tảng,
 * nên dùng được ngay cả khi chưa có app riêng / chưa qua duyệt.
 *
 * Kiểm token THẬT trước khi lưu — lưu một token chết là để người ta tưởng đã nối
 * xong rồi vài ngày sau mới phát hiện chẳng bài nào lên.
 */
router.post('/accounts/connect-token', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        if (!coKhoaVault()) {
            throw new LoiMkt('Máy chủ chưa khai MARKETING_VAULT_KEY nên chưa lưu token an toàn được. Báo quản trị hệ thống.', 503, 'THIEU_KHOA_VAULT')
        }
        const platform = String(req.body?.platform || '').trim().toLowerCase()
        const token = String(req.body?.accessToken || '').trim()
        if (!(NEN_TANG as readonly string[]).includes(platform)) {
            throw new LoiMkt(`Nền tảng phải là một trong: ${NEN_TANG.join(', ')}`)
        }
        if (!token) throw new LoiMkt('Thiếu accessToken.')
        const idKhai = String(req.body?.externalId || '').trim() || undefined
        let hetHanKhai: Date | null = null
        if (req.body?.expiresAt) {
            hetHanKhai = new Date(req.body.expiresAt)
            if (isNaN(hetHanKhai.getTime())) throw new LoiMkt('Thời điểm hết hạn token không hợp lệ.')
        }
        const lamMoi = ['refreshToken', 'clientId', 'clientSecret'].every(k => String(req.body?.[k] || '').trim())
            ? { refreshToken: String(req.body.refreshToken).trim(), clientId: String(req.body.clientId).trim(), clientSecret: String(req.body.clientSecret).trim() }
            : null

        // Hỏi thẳng nền tảng: token này là của ai, còn sống không.
        let info: any
        try {
            info = await xacMinhKenh(platform, token, idKhai)
        } catch (e: any) {
            /* Trả NGUYÊN VĂN lý do nền tảng từ chối — đây là thứ người dùng cần để
             * sửa, và là thứ hay bị `errMsg()` nuốt thành "Internal server error". */
            throw new LoiMkt(`Token không dùng được: ${e?.message || 'nền tảng từ chối'}`, 400, 'TOKEN_KHONG_DUNG')
        }

        const prisma: any = req.storePrisma
        const externalId = String(info.externalId)
        /* Một trang chỉ thuộc MỘT thương hiệu: nối trang đang thuộc thương hiệu khác
         * thì từ chối, không lặng lẽ "kéo" nó sang (bài hẹn của thương hiệu kia sẽ
         * đổi chủ theo mà không ai biết). */
        const daCo = await prisma.mktAccount.findUnique({ where: { platform_externalId: { platform, externalId } } })
        if (daCo && daCo.brandId && daCo.brandId !== req.mktBrand.id) {
            const cua = (req.mktBrands || []).find(b => b.id === daCo.brandId)
            throw new LoiMkt(`Trang này đang được nối ở thương hiệu "${cua?.name || 'khác'}". Ngắt ở đó trước rồi mới nối vào đây.`, 409, 'KENH_THUOC_THUONG_HIEU_KHAC')
        }
        /* Hạn token: người dùng khai thì theo khai. Không khai:
         *   · Facebook Page token dán tay sống ~60 ngày, KHÔNG tự gia hạn được ⇒ ghi 55
         *     ngày để còn kịp nhắc trước khi chết.
         *   · YouTube có thông tin làm mới ⇒ token 1 giờ, worker tự làm mới.
         *   · Còn lại: không biết ⇒ để trống (không đoán — đoán sai là tự gia hạn nhầm
         *     giờ hoặc báo hết hạn oan). */
        const hetHan = hetHanKhai
            ?? (platform === 'facebook' ? new Date(Date.now() + 55 * 86400_000)
                : platform === 'youtube' && lamMoi ? new Date(Date.now() + 55 * 60_000)
                    : null)
        const luu = {
            name: info.name || `Kênh ${externalId}`,
            category: info.category ?? null,
            avatar: info.avatar ?? null,
            followers: typeof info.followers === 'number' ? info.followers : null,
            accessToken: maHoa(token),
            refreshSecret: lamMoi ? maHoa(JSON.stringify(lamMoi)) : null,
            tokenExpiresAt: hetHan,
            status: 'active',
            lastSyncAt: new Date(),
            brandId: req.mktBrand.id,
        }
        const acc = await prisma.mktAccount.upsert({
            where: { platform_externalId: { platform, externalId } },
            create: { platform, externalId, connectedBy: req.user?.userId, ...luu },
            update: luu,
        })
        await batCoMarketing(req.user?.branchSchema || req.user?.storeSchema)
        res.json({ success: true, data: { ...loc(acc), thongTin: info.thongTin ?? null } })
    } catch (err) { traLoi(res, err) }
})

/** Hỏi lại nền tảng token còn sống không (và làm tươi tên/ảnh/người theo dõi). */
router.post('/accounts/:id/verify', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const acc = await prisma.mktAccount.findFirst({ where: { id: String(req.params.id), brandId: req.mktBrand.id } })
        if (!acc) throw new LoiMkt('Không tìm thấy kênh trong thương hiệu này.', 404)
        try {
            const info = await xacMinhKenh(acc.platform, giaiMa(acc.accessToken), acc.externalId)
            const moi = await prisma.mktAccount.update({
                where: { id: acc.id },
                data: { name: info.name || acc.name, avatar: info.avatar ?? acc.avatar, followers: info.followers ?? acc.followers, status: 'active', lastSyncAt: new Date() },
            })
            res.json({ success: true, data: { ...loc(moi), thongTin: info.thongTin ?? null } })
        } catch (e: any) {
            await prisma.mktAccount.update({ where: { id: acc.id }, data: { status: 'token_expired' } })
            throw new LoiMkt(`Kênh không dùng được: ${e?.message || 'nền tảng từ chối'}. Nối lại token.`, 400, 'TOKEN_KHONG_DUNG')
        }
    } catch (err) { traLoi(res, err) }
})

// ─── MEDIA ───────────────────────────────────────────────────────────────────
/** Tải tệp lên (≤30MB — Cloud Run chặn thân yêu cầu lớn hơn). Video lớn hơn: dán URL. */
router.post('/assets/upload', ...mkt, requireRole(...QUAN_LY), (req: any, res: Response, next: any) => {
    taiLen.single('file')(req, res, (err: any) => {
        if (err) return traLoi(res, new LoiMkt(err?.code === 'LIMIT_FILE_SIZE'
            ? 'Tệp quá 30MB. Video lớn hơn: tải lên nơi khác rồi dán URL công khai.' : `Tải tệp hỏng: ${err?.message}`, 413))
        next()
    })
}, async (req: MktRequest & { file?: any }, res: Response) => {
    try {
        const f = req.file
        if (!f?.buffer?.length) throw new LoiMkt('Chưa chọn tệp.')
        const loai = nhanDangMedia(f.buffer)
        if (!loai) throw new LoiMkt('Chỉ nhận ảnh JPEG/PNG hoặc video MP4/MOV (nhận dạng theo nội dung tệp).', 415)
        const { storagePath, url } = await luuMedia(schemaCua(req), req.mktBrand.id, f.buffer, loai)
        let ten = String(req.body?.name || f.originalname || 'Media')
        try { ten = Buffer.from(ten, 'latin1').toString('utf8') } catch { }
        const a = await (req.storePrisma as any).mktAsset.create({
            data: {
                brandId: req.mktBrand.id, name: ten.slice(0, 200), type: loai.type, mime: loai.mime,
                bytes: f.buffer.length, localFile: '', storagePath, url, createdBy: req.user?.userId,
            },
        })
        const { localFile, storagePath: _sp, ...ra } = a
        res.status(201).json({ success: true, data: ra })
    } catch (err) { traLoi(res, err) }
})

/** Media nằm sẵn ở một URL HTTPS công khai (video lớn, ảnh trên CDN của shop…). */
router.post('/assets/url', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const url = kiemUrlCongKhai(String(req.body?.url || ''))
        if (!url) throw new LoiMkt('Cần URL HTTPS công khai (không nhận địa chỉ nội bộ).')
        const type = req.body?.type === 'video' ? 'video' : 'image'
        const mime = type === 'video' ? 'video/mp4' : /\.png(\?|$)/i.test(url) ? 'image/png' : 'image/jpeg'
        const a = await (req.storePrisma as any).mktAsset.create({
            data: {
                brandId: req.mktBrand.id, name: String(req.body?.name || url.split('/').pop() || 'Media').slice(0, 200),
                type, mime, bytes: 0, localFile: '', url, createdBy: req.user?.userId,
            },
        })
        const { localFile, storagePath, ...ra } = a
        res.status(201).json({ success: true, data: ra })
    } catch (err) { traLoi(res, err) }
})

router.delete('/assets/:id', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const a = await prisma.mktAsset.findFirst({ where: { id: String(req.params.id), brandId: req.mktBrand.id } })
        if (!a) throw new LoiMkt('Không tìm thấy media trong thương hiệu này.', 404)
        /* Bài đang chờ đăng mà mất media thì worker báo MEDIA_MAT — chặn từ đây cho rõ. */
        const dangDung = await prisma.mktContent.findFirst({
            where: { brandId: req.mktBrand.id, status: { in: ['approved', 'scheduled'] }, OR: [{ assetIds: { contains: a.id } }, { variants: { contains: a.id } }] },
            select: { title: true },
        })
        if (dangDung) throw new LoiMkt(`Media đang dùng trong bài "${dangDung.title || 'không tên'}" đã duyệt/lên lịch.`, 409)
        await prisma.mktAsset.delete({ where: { id: a.id } })
        await xoaMedia(a.storagePath, schemaCua(req), req.mktBrand.id).catch((e: any) => console.warn('[mkt] xoá tệp media hỏng:', e?.message))
        res.json({ success: true })
    } catch (err) { traLoi(res, err) }
})

router.delete('/accounts/:id', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const kq = await (req.storePrisma as any).mktAccount.deleteMany({
            where: { id: String(req.params.id), brandId: req.mktBrand.id },
        })
        if (!kq.count) throw new LoiMkt('Không tìm thấy kênh trong thương hiệu này.', 404)
        res.json({ success: true })
    } catch (err) { traLoi(res, err) }
})

// ─── CHIẾN DỊCH ──────────────────────────────────────────────────────────────
router.get('/campaigns', ...mkt, async (req: MktRequest, res: Response) => {
    try {
        const ds = await (req.storePrisma as any).mktCampaign.findMany({
            where: { brandId: req.mktBrand.id }, orderBy: { createdAt: 'desc' },
        })
        res.json({ success: true, data: ds })
    } catch (err) { traLoi(res, err) }
})

router.post('/campaigns', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const name = String(req.body?.name || '').trim()
        if (!name) throw new LoiMkt('Thiếu tên chiến dịch.')
        const c = await (req.storePrisma as any).mktCampaign.create({
            data: {
                brandId: req.mktBrand.id,
                name, goal: String(req.body?.goal || ''),
                startAt: req.body?.startAt ? new Date(req.body.startAt) : null,
                endAt: req.body?.endAt ? new Date(req.body.endAt) : null,
                createdBy: req.user?.userId,
            },
        })
        res.json({ success: true, data: c })
    } catch (err) { traLoi(res, err) }
})

/** Tạm dừng chiến dịch GIỮ luôn cả hàng đợi — worker thấy `paused` là hoãn. */
router.patch('/campaigns/:id', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const id = String(req.params.id)
        if (!await prisma.mktCampaign.findFirst({ where: { id, brandId: req.mktBrand.id }, select: { id: true } }))
            throw new LoiMkt('Không tìm thấy chiến dịch trong thương hiệu này.', 404)
        const data: any = {}
        for (const k of ['name', 'goal', 'status'] as const) if (req.body?.[k] !== undefined) data[k] = req.body[k]
        if (data.status !== undefined && !['active', 'paused', 'done'].includes(data.status))
            throw new LoiMkt('status phải là active, paused hoặc done.')
        const c = await prisma.mktCampaign.update({ where: { id }, data })
        res.json({ success: true, data: c })
    } catch (err) { traLoi(res, err) }
})

// ─── NỘI DUNG ────────────────────────────────────────────────────────────────
router.get('/contents', ...mkt, async (req: MktRequest, res: Response) => {
    try {
        const where: any = { brandId: req.mktBrand.id }
        if (req.query.status) where.status = String(req.query.status)
        if (req.query.campaignId) where.campaignId = String(req.query.campaignId)
        const ds = await (req.storePrisma as any).mktContent.findMany({
            where, orderBy: { updatedAt: 'desc' }, take: 200,
            include: { publications: { include: { account: { select: { platform: true, name: true } } } } },
        })
        res.json({ success: true, data: ds.map(noiDung) })
    } catch (err) { traLoi(res, err) }
})

router.post('/contents', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const brandId = req.mktBrand.id
        const body = String(req.body?.body || '').trim()
        const variants = await kiemPhienBan(prisma, brandId, req.body?.variants)
        const assetIds = Array.isArray(req.body?.assetIds) ? req.body.assetIds.map(String) : []
        await kiemMedia(prisma, brandId, [...assetIds, ...variants.flatMap(v => v.assetIds)])
        if (!body && !variants.some(v => v.text.trim() || v.assetIds.length))
            throw new LoiMkt('Nội dung bài không được để trống.')
        const campaignId = req.body?.campaignId || null
        if (campaignId && !await prisma.mktCampaign.findFirst({ where: { id: campaignId, brandId }, select: { id: true } }))
            throw new LoiMkt('Chiến dịch không thuộc thương hiệu này.', 400, 'SAI_THUONG_HIEU')
        const c = await prisma.mktContent.create({
            data: {
                brandId, campaignId,
                title: String(req.body?.title || ''), body,
                hashtags: JSON.stringify(req.body?.hashtags || []),
                linkUrl: req.body?.linkUrl || null,
                assetIds: JSON.stringify(assetIds),
                variants: JSON.stringify(variants),
                productIds: JSON.stringify(req.body?.productIds || []),
                status: 'pending', source: req.body?.source === 'ai' ? 'ai' : 'manual',
                createdBy: req.user?.userId,
            },
        })
        res.json({ success: true, data: noiDung(c) })
    } catch (err) { traLoi(res, err) }
})

/**
 * ⛔ SỬA LÀ MẤT DUYỆT. `revision` tăng, `approvedRevision` về null.
 * Bài đang chờ trong hàng đợi sẽ bị worker từ chối (khoá "CHUA_DUYET") thay vì
 * đăng bản cũ — đó là điều đúng: người duyệt đã duyệt CHỮ KHÁC.
 */
router.patch('/contents/:id', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const brandId = req.mktBrand.id
        const id = String(req.params.id)
        const cu = await prisma.mktContent.findFirst({ where: { id, brandId } })
        if (!cu) throw new LoiMkt('Không tìm thấy nội dung trong thương hiệu này.', 404)

        const data: any = {}
        for (const k of ['title', 'body', 'linkUrl'] as const) if (req.body?.[k] !== undefined) data[k] = req.body[k]
        if (req.body?.hashtags !== undefined) data.hashtags = JSON.stringify(req.body.hashtags)
        if (req.body?.assetIds !== undefined) {
            const ids = Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String) : []
            await kiemMedia(prisma, brandId, ids)
            data.assetIds = JSON.stringify(ids)
        }
        if (req.body?.variants !== undefined) {
            const v = await kiemPhienBan(prisma, brandId, req.body.variants)
            await kiemMedia(prisma, brandId, v.flatMap(x => x.assetIds))
            data.variants = JSON.stringify(v)
        }
        if (req.body?.campaignId !== undefined) {
            const cid = req.body.campaignId || null
            if (cid && !await prisma.mktCampaign.findFirst({ where: { id: cid, brandId }, select: { id: true } }))
                throw new LoiMkt('Chiến dịch không thuộc thương hiệu này.', 400, 'SAI_THUONG_HIEU')
            data.campaignId = cid
        }

        const doiChu = ['title', 'body', 'linkUrl', 'hashtags', 'assetIds', 'variants']
            .some(k => data[k] !== undefined && data[k] !== (cu as any)[k])
        if (doiChu) {
            data.revision = cu.revision + 1
            data.approvedRevision = null
            data.approvedAt = null
            data.approvedBy = null
            if (['approved', 'scheduled', 'rejected'].includes(cu.status)) data.status = 'pending'
        }
        const c = await prisma.mktContent.update({ where: { id }, data })
        res.json({ success: true, data: noiDung(c), matDuyet: doiChu && cu.approvedRevision !== null })
    } catch (err) { traLoi(res, err) }
})

/** Duyệt ĐÚNG bản mình đang nhìn: gửi kèm `revision`, lệch là từ chối (người khác vừa sửa). */
router.post('/contents/:id/approve', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const c = await prisma.mktContent.findFirst({ where: { id: String(req.params.id), brandId: req.mktBrand.id } })
        if (!c) throw new LoiMkt('Không tìm thấy nội dung trong thương hiệu này.', 404)
        if (req.body?.revision !== undefined && Number(req.body.revision) !== c.revision) {
            throw new LoiMkt('Bài vừa được sửa sau khi bạn mở. Tải lại để duyệt bản mới nhất.', 409, 'REVISION_CU')
        }
        /* Duyệt bài mà kênh không nhận nổi là duyệt suông — tới lúc lên lịch mới bị bỏ qua
         * (HUTI 30/09 duyệt bài Threads 545/500 ký tự). Nói rõ kênh nào dài bao nhiêu. */
        const loiChu = await loiChuTheoKenh(prisma, req.mktBrand.id, jsonMang(c.variants), c.body, c.title)
        if (loiChu.length)
            throw new LoiMkt(`Chưa duyệt được — ${loiChu.join(' | ')} Bấm "Chỉnh sửa" để sửa rồi duyệt lại.`, 422, 'SAI_DINH_DANG')
        const kq = await prisma.mktContent.update({
            where: { id: c.id },
            data: {
                approvedRevision: c.revision, approvedAt: new Date(),
                approvedBy: req.user?.userId, status: 'approved', rejectReason: null,
            },
        })
        res.json({ success: true, data: noiDung(kq) })
    } catch (err) { traLoi(res, err) }
})

router.post('/contents/:id/reject', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const kq = await prisma.mktContent.updateMany({
            where: { id: String(req.params.id), brandId: req.mktBrand.id },
            data: { status: 'rejected', rejectReason: String(req.body?.reason || ''), approvedRevision: null },
        })
        if (!kq.count) throw new LoiMkt('Không tìm thấy nội dung trong thương hiệu này.', 404)
        res.json({ success: true })
    } catch (err) { traLoi(res, err) }
})

// ─── LÊN LỊCH ────────────────────────────────────────────────────────────────
/**
 * Tạo một `MktPublication` cho MỖI kênh được chọn. Mỗi kênh một dòng riêng nên
 * kênh này hỏng không kéo kênh kia hỏng theo. Không gửi `accountIds` thì dùng các
 * kênh có phiên bản riêng trong bài.
 *
 * `idempotencyKey` gồm cả revision: gọi hai lần cùng bài + cùng kênh + cùng bản
 * thì đụng ràng buộc UNIQUE và bị bỏ qua, không đẻ bài thứ hai.
 */
router.post('/contents/:id/schedule', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const brandId = req.mktBrand.id
        const c = await prisma.mktContent.findFirst({ where: { id: String(req.params.id), brandId } })
        if (!c) throw new LoiMkt('Không tìm thấy nội dung trong thương hiệu này.', 404)
        const accountIds: string[] = Array.isArray(req.body?.accountIds) ? req.body.accountIds.map(String) : []
        const khi = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : new Date()
        const { taoRa, boQua } = await lenLich(prisma, req.mktBrand, c, accountIds, khi)
        if (taoRa.length) await batCoMarketing(req.user?.branchSchema || req.user?.storeSchema)
        res.json({ success: true, data: { daTao: taoRa.length, boQua, publications: taoRa } })
    } catch (err) { traLoi(res, err) }
})

/** Soát bài trên từng kênh TRƯỚC khi duyệt/lên lịch — để người sửa kịp. */
router.post('/contents/:id/validate', ...mkt, async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const brandId = req.mktBrand.id
        const c = await prisma.mktContent.findFirst({ where: { id: String(req.params.id), brandId } })
        if (!c) throw new LoiMkt('Không tìm thấy nội dung trong thương hiệu này.', 404)
        let ids: string[] = Array.isArray(req.body?.accountIds) ? req.body.accountIds.map(String) : []
        if (!ids.length) ids = jsonMang(c.variants).map((v: any) => String(v.accountId))
        const ketQua: any[] = []
        for (const id of ids) {
            const acc = await prisma.mktAccount.findFirst({ where: { id, brandId } })
            if (!acc) { ketQua.push({ accountId: id, loi: ['Không có kênh này trong thương hiệu.'] }); continue }
            ketQua.push({ accountId: id, platform: acc.platform, name: acc.name, loi: await loiKhiDangLen(prisma, req.mktBrand, c, acc) })
        }
        res.json({ success: true, data: { dat: ketQua.length > 0 && ketQua.every(k => !k.loi.length), kenh: ketQua } })
    } catch (err) { traLoi(res, err) }
})

router.get('/publications', ...mkt, async (req: MktRequest, res: Response) => {
    try {
        const where: any = { content: { brandId: req.mktBrand.id } }
        if (req.query.status) where.status = String(req.query.status)
        const ds = await (req.storePrisma as any).mktPublication.findMany({
            where, orderBy: { scheduledAt: 'desc' }, take: 200,
            include: {
                account: { select: { platform: true, name: true } },
                content: { select: { title: true, body: true } },
            },
        })
        res.json({ success: true, data: ds })
    } catch (err) { traLoi(res, err) }
})

router.post('/publications/:id/cancel', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        /* CHỈ huỷ được khi CHƯA gửi. Bài đang `processing` mà cho huỷ thì worker
         * vẫn gửi tiếp và ta mất dấu — điều kiện nằm TRONG câu update. */
        const kq = await (req.storePrisma as any).mktPublication.updateMany({
            where: { id: String(req.params.id), status: 'queued', content: { brandId: req.mktBrand.id } },
            data: { status: 'cancelled' },
        })
        if (kq.count === 0) {
            throw new LoiMkt('Chỉ huỷ được bài đang chờ. Bài đang gửi hoặc đã gửi thì không huỷ được ở đây.', 409, 'KHONG_HUY_DUOC')
        }
        res.json({ success: true })
    } catch (err) { traLoi(res, err) }
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
router.post('/publications/:id/quyet', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const id = String(req.params.id)
        const quyet = String(req.body?.quyet || '')
        const p = await prisma.mktPublication.findFirst({ where: { id, content: { brandId: req.mktBrand.id } } })
        if (!p) throw new LoiMkt('Không tìm thấy bài trong thương hiệu này.', 404)
        if (!['uncertain', 'failed'].includes(p.status)) {
            throw new LoiMkt(`Bài đang ở trạng thái "${p.status}", không cần quyết.`, 409)
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
        throw new LoiMkt('quyet phải là "da-len" hoặc "chua-len".')
    } catch (err) { traLoi(res, err) }
})

// ─── SỐ LIỆU ─────────────────────────────────────────────────────────────────
/**
 * Kéo số liệu các bài đã đăng (60 ngày gần nhất, tối đa 50 bài / lần) về MktMetric.
 * Nền tảng không trả số nào thì để NULL — "chưa đọc được" khác hẳn "bằng không".
 * Bài hỏng không kéo cả lượt hỏng theo: đếm riêng, báo lại.
 * Trả CHI TIẾT TỪNG BÀI (số vừa đo + bài đã lên được bao lâu): chỉ thấy "0" trên bảng tổng
 * thì không phân biệt được "bài mới lên chưa ai xem" với "đọc sai" (HUTI 30/09).
 */
router.post('/analytics/sync', ...mkt, requireRole(...QUAN_LY), async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const ds = await prisma.mktPublication.findMany({
            where: {
                status: 'sent', remotePostId: { not: null },
                sentAt: { gte: new Date(Date.now() - 60 * 86400_000) },
                content: { brandId: req.mktBrand.id },
            },
            orderBy: { sentAt: 'desc' }, take: 50,
            include: { account: true, content: { select: { title: true } } },
        })
        let dongBo = 0
        const hong: string[] = []
        const chiTiet: any[] = []
        for (const p of ds) {
            const dong: any = {
                tieuDe: p.content?.title || '', kenh: p.account.name, platform: p.account.platform,
                daDangPhut: p.sentAt ? Math.round((Date.now() - +new Date(p.sentAt)) / 60_000) : null,
            }
            try {
                Object.assign(dong, await keoSoLieu(prisma, p))
                dongBo++
            } catch (e: any) {
                danhDauHong(p.id)
                dong.loi = e?.message || 'không đọc được'
                hong.push(`${p.account.name}: ${dong.loi}`)
            }
            chiTiet.push(dong)
        }
        res.json({ success: true, data: { dongBo, tong: ds.length, hong: hong.slice(0, 20), chiTiet, catBot: ds.length === 50, luc: new Date() } })
    } catch (err) { traLoi(res, err) }
})

/** Số liệu mới nhất của từng bài, cộng theo nền tảng. Ô null = chưa có dữ liệu, KHÔNG phải 0. */
async function tongChiSo(prisma: any, brandId: string) {
    const pubs = await prisma.mktPublication.findMany({
        where: { status: 'sent', content: { brandId } },
        select: { id: true, contentId: true, account: { select: { platform: true } } },
        take: 500,
    })
    if (!pubs.length) return { theoNenTang: [], theoBai: [], lanCuoi: null }
    const metrics = await prisma.mktMetric.findMany({
        where: { publicationId: { in: pubs.map((p: any) => p.id) } },
        orderBy: { snapshotAt: 'desc' },
    })
    const moiNhat = new Map<string, any>()
    for (const m of metrics) if (!moiNhat.has(m.publicationId)) moiNhat.set(m.publicationId, m)
    const theo: Record<string, any> = {}
    /* Số liệu mới nhất TỪNG BÀI — màn Báo cáo liệt kê "bài nào, nền tảng nào, đo lúc nào".
     * Thiếu danh sách này, giao diện đọc snapshots[].postId của phần tử không có ⇒ vỡ màn. */
    const theoBai: any[] = []
    for (const p of pubs) {
        const nen = p.account.platform
        const t = theo[nen] ||= { platform: nen, soBai: 0, coSoLieu: 0, views: null, likes: null, comments: null, shares: null }
        t.soBai++
        const m = moiNhat.get(p.id)
        if (!m) continue
        t.coSoLieu++
        for (const k of ['views', 'likes', 'comments', 'shares'])
            if (m[k] !== null && m[k] !== undefined) t[k] = (t[k] ?? 0) + m[k]
        theoBai.push({
            postId: p.contentId, publicationId: p.id, platform: nen, observedAt: m.snapshotAt,
            views: m.views ?? null, likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null,
        })
    }
    theoBai.sort((a, b) => +new Date(b.observedAt) - +new Date(a.observedAt))
    return { theoNenTang: Object.values(theo), theoBai, lanCuoi: metrics[0]?.snapshotAt ?? null }
}

// ─── TÌNH TRẠNG ──────────────────────────────────────────────────────────────
async function tinhTrang(prisma: any, brandId: string) {
    const cuaBai = { content: { brandId } }
    const [soKenh, cho, moHo, hong, daGui] = [
        await prisma.mktAccount.count({ where: { status: 'active', brandId } }),
        await prisma.mktPublication.count({ where: { status: 'queued', ...cuaBai } }),
        await prisma.mktPublication.count({ where: { status: 'uncertain', ...cuaBai } }),
        await prisma.mktPublication.count({ where: { status: 'failed', ...cuaBai } }),
        await prisma.mktPublication.count({ where: { status: 'sent', ...cuaBai } }),
    ]
    return {
        soKenh, dangCho: cho, moHo, hong, daGui,
        coKhoaVault: coKhoaVault(),
        cangNhac: !coKhoaVault()
            ? 'Máy chủ chưa khai MARKETING_VAULT_KEY — chưa nối kênh được.'
            : soKenh === 0 ? 'Chưa nối kênh nào. Vào Kết nối kênh để dán token.'
                : moHo > 0 ? `${moHo} bài GỬI RỒI MÀ CHƯA RÕ KẾT QUẢ — cần bạn vào nền tảng kiểm rồi quyết.`
                    : null,
    }
}

/** Một thương hiệu đang ở đâu — để giao diện biết cần nhắc gì. */
router.get('/tinh-trang', ...mkt, async (req: MktRequest, res: Response) => {
    try {
        res.json({ success: true, data: await tinhTrang(req.storePrisma, req.mktBrand.id) })
    } catch (err) { traLoi(res, err) }
})

/**
 * MỘT lần gọi cho cả màn hình (kengi.vn/marketing): thương hiệu + hồ sơ, kênh, chiến
 * dịch, bài (kèm lượt đăng), media, tình trạng. Tuần tự — pool prod 1 kết nối/cửa hàng.
 */
router.get('/state', ...mkt, async (req: MktRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        const brandId = req.mktBrand.id
        const accounts = await prisma.mktAccount.findMany({ where: { brandId }, orderBy: { createdAt: 'asc' } })
        const campaigns = await prisma.mktCampaign.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' } })
        const contents = await prisma.mktContent.findMany({
            where: { brandId }, orderBy: { updatedAt: 'desc' }, take: 200,
            include: { publications: { include: { account: { select: { platform: true, name: true } } } } },
        })
        const assets = await prisma.mktAsset.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 200 })
        res.json({
            success: true,
            data: {
                brand: hoSo(req.mktBrand),
                brands: (req.mktBrands || []).map(b => ({ id: b.id, name: b.name })),
                maxBrands: MAX_THUONG_HIEU,
                accounts: accounts.map(loc),
                campaigns,
                contents: contents.map(noiDung),
                assets: assets.map(({ localFile, storagePath, ...a }: any) => a),
                tinhTrang: await tinhTrang(prisma, brandId),
                analytics: await tongChiSo(prisma, brandId),
                platforms: NEN_TANG,
            },
        })
    } catch (err) { traLoi(res, err) }
})

export default router
