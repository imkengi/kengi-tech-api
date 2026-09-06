// ═══════════════════════════════════════════════════════════════════════════════
//  MEDIA BÁN HÀNG — kho video/ảnh cho kênh sàn (Shopee Video, video mua sắm TikTok)
//
//  VÌ SAO KHÔNG LƯU FILE VÀO ĐĨA: Cloud Run xoá sạch đĩa mỗi lần khởi động lại, và
//  prod CHƯA bật GCS (đo 06/09/2026: cloudbuild.yaml và biến môi trường Cloud Run
//  đều không có GCS_BUCKET). Video Shopee cho tới 1GB thì càng không thể để trên
//  đĩa tạm. Nguồn dùng lại thứ đã chạy sẵn: Google Drive của chính cửa hàng
//  (OAuth per-store đã có ở lib/driveOAuth) hoặc một đường liên kết ngoài.
//
//  VỀ VIỆC ĐĂNG LÊN SÀN — nói thẳng để không ai tưởng bấm là xong:
//  cả hai sàn ĐỀU có API đăng video, nhưng ĐỀU đòi một luồng uỷ quyền KHÁC với
//  token bán hàng đang có (tra tài liệu gốc 06/09/2026):
//    · Shopee — v2.media.init_video_upload (business=3 Video, scene=1 Shopee Video,
//      1–180 giây, ≤1GB, chia khối theo part_size sàn trả) → upload_video_part →
//      complete_video_upload → v2.video.get_cover_list → v2.video.edit_video_info
//      → v2.video.post_video. Là API kiểu USER: ký bằng `user_id`, KHÔNG phải
//      `shop_id`; app phải đăng ký loại "Shopee Video Management"; và cửa hàng
//      phải đồng ý Điều khoản Shopee Video trong Seller Center trước.
//    · TikTok — POST /affiliate_creator/202505/videos/video_files (≤10MB, lớn hơn
//      dùng Large File Uploads) → POST /affiliate_creator/202603/videos. Scope
//      `creator.video.write`, header x-tts-access-token phải là token CREATOR
//      (user_type=1), không dùng lại token TikTok Shop.
//
//  `GET /san-sang` trả về đúng những gì còn thiếu. `trangThai` chỉ được chuyển
//  sang 'da_dang' khi SÀN thật sự trả về mã video — không tự đánh dấu.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import { errMsg } from '../lib/errorResponse'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'

const router = Router()

const TRANG_THAI = ['nhap', 'da_len_lich', 'cho_dang', 'da_dang', 'loi'] as const
const KENH = ['shopee', 'tiktok'] as const
const NGUON = ['drive', 'lien_ket'] as const

/** Giới hạn của từng sàn — lấy từ tài liệu gốc, để kiểm TRƯỚC khi tốn công tải lên. */
const GIOI_HAN = {
    shopee: { giayToiThieu: 1, giayToiDa: 180, byteToiDa: 1024 * 1024 * 1024, ghiChu: 'Shopee Video: 1–180 giây, tối đa 1GB.' },
    tiktok: { giayToiThieu: 1, giayToiDa: 600, byteToiDa: 10 * 1024 * 1024, ghiChu: 'TikTok: tải trực tiếp tối đa 10MB (lớn hơn phải dùng Large File Uploads), tỉ lệ 9:16 đến 16:9, khuyến nghị 720p và dài hơn 30 giây.' },
} as const

/* Đọc hỏng KHÁC HẲN "không có". Bảng SanMedia là bảng MỚI: cửa hàng nào chưa chạy
 * sync-schemas thì Prisma ném P2021 (bảng không tồn tại). Trả rỗng lặng lẽ là để
 * chủ shop tưởng kho media trống, rồi thêm lại từ đầu. */
function laThieuBang(e: any): boolean {
    const s = String(e?.code || '') + ' ' + String(e?.message || '')
    return /P2021|does not exist|relation .* does not exist/i.test(s)
}
const loiThieuBang = {
    success: false,
    error: 'Bảng SanMedia chưa có trên cửa hàng này. Chạy POST /api/admin/sync-schemas rồi thử lại.',
    canSyncSchema: true,
}

/**
 * SKU trong kho → mã sản phẩm TRÊN SÀN của đúng gian hàng đang chọn.
 *
 * Đây là chỗ dễ sai nhất: `product_id` mà Shopee/TikTok nhận là mã LISTING trên
 * gian hàng đó (`OnlineProduct.platformProductId`), KHÔNG phải id sản phẩm trong
 * kho. Cùng một SKU bán ở hai gian hàng là hai mã khác nhau, nên phải tra theo
 * `channelId`; đổi gian hàng thì mọi mã đã tra phải tra lại.
 *
 * SKU không tra ra listing thì để `maTrenSan = null` và NÓI RA — im lặng bỏ qua là
 * đăng lên sàn thiếu mất sản phẩm mà không ai biết.
 */
async function giaiSku(prisma: any, channelId: string | null, skus: string[]) {
    const ra = new Map<string, { maTrenSan: string | null; productId: string | null; tenSp: string | null }>()
    const sach = [...new Set(skus.map(x => String(x || '').trim()).filter(Boolean))]
    if (!sach.length) return ra

    const trongKho = await prisma.product.findMany({
        where: { sku: { in: sach } }, select: { id: true, sku: true, name: true },
    }).catch(() => [])
    const banKho = new Map(trongKho.map((p: any) => [String(p.sku), p]))

    let banSan = new Map<string, any>()
    if (channelId) {
        const tren = await prisma.onlineProduct.findMany({
            where: { channelId, sku: { in: sach } },
            select: { sku: true, platformProductId: true, name: true },
        }).catch(() => [])
        banSan = new Map(tren.map((x: any) => [String(x.sku), x]))
    }

    for (const sku of sach) {
        const kho: any = banKho.get(sku)
        const san: any = banSan.get(sku)
        ra.set(sku, {
            maTrenSan: san?.platformProductId ?? null,
            productId: kho?.id ?? null,
            tenSp: kho?.name ?? san?.name ?? null,
        })
    }
    return ra
}

/**
 * Ghi lại danh sách SKU gắn vào một video: dựng LẠI từ đầu chứ không cộng thêm.
 *
 * Cộng thêm thì bỏ một SKU ra khỏi danh sách sẽ không bao giờ mất — chủ shop sửa
 * mà số cũ vẫn còn, y hệt bẫy "bản ghi con phải dựng lại, không chỉ thêm vào".
 */
async function ganSku(prisma: any, mediaId: string, channelId: string | null, skus: string[], nhan: Record<string, string>) {
    const sach = [...new Set(skus.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 50)
    const tra = await giaiSku(prisma, channelId, sach)
    await prisma.sanMediaSanPham.deleteMany({ where: { mediaId } })
    if (!sach.length) return
    for (let i = 0; i < sach.length; i++) {
        const sku = sach[i]!
        const t = tra.get(sku)
        await prisma.sanMediaSanPham.create({
            data: {
                mediaId, sku,
                productId: t?.productId ?? null,
                maTrenSan: t?.maTrenSan ?? null,
                // TikTok chặn nhãn quá 30 ký tự (mã lỗi 16011007) — cắt ngay từ đây
                // thay vì để sàn từ chối lúc đăng.
                nhan: String(nhan?.[sku] || t?.tenSp || sku).slice(0, 30),
                thuTu: i,
            },
        })
    }
}

// ─── Danh sách kho media ───────────────────────────────────────────────────────
router.get('/', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { kenh, trangThai, q } = req.query
        const where: any = {}
        if (kenh && KENH.includes(String(kenh) as any)) where.kenh = String(kenh)
        if (trangThai && TRANG_THAI.includes(String(trangThai) as any)) where.trangThai = String(trangThai)
        if (q) where.OR = [
            { ten: { contains: String(q), mode: 'insensitive' } },
            { caption: { contains: String(q), mode: 'insensitive' } },
        ]

        const ds = await prisma.sanMedia.findMany({
            where, orderBy: { createdAt: 'desc' }, take: 500,
            include: { sanPham: { orderBy: { thuTu: 'asc' } } },
        })

        /* Đếm thẳng ra số SKU CHƯA tra được listing trên gian hàng. Đây là thứ chặn
         * đăng, nên phải nằm ngay trên danh sách chứ không bắt bấm vào từng video mới
         * thấy — giấu trong chi tiết là tới lúc đăng mới vỡ. */
        res.json({
            success: true,
            data: {
                items: ds.map((m: any) => ({
                    ...m,
                    soSkuChuaTraDuoc: (m.sanPham || []).filter((x: any) => !x.maTrenSan).length,
                })),
                tong: ds.length,
                chamTran: ds.length >= 500,
                gioiHan: GIOI_HAN,
            },
        })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('GET /san-media lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được kho media') })
    }
})

// ─── Video có trong Drive mà CHƯA nằm trong kho ────────────────────────────────
router.get('/drive', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const cai = await prisma.storeSettings.findFirst({ select: { driveFolderId: true } as any }) as any
        const folderId = cai?.driveFolderId || null
        if (!folderId) {
            res.json({
                success: true,
                data: { items: [], chuaNoiDrive: true, huongDan: 'Vào Cài đặt → Google Drive, chọn thư mục chứa video rồi thử lại.' },
            })
            return
        }

        const { google } = require('googleapis') as typeof import('googleapis')
        const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] })
        const drive = google.drive({ version: 'v3', auth })

        /* CHỈ thư mục đang chọn, KHÔNG đệ quy: thư mục gốc của cửa hàng còn chứa
         * video đóng gói (DON_*) sinh ra hàng trăm file mỗi ngày — kéo hết vào đây
         * là chôn mất mấy video marketing thật. */
        const r = await drive.files.list({
            q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
            fields: 'files(id,name,mimeType,size,thumbnailLink,videoMediaMetadata(durationMillis,width,height),createdTime)',
            orderBy: 'createdTime desc',
            pageSize: 200,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        })
        const files = r.data.files || []

        const daCo = new Set(
            (await prisma.sanMedia.findMany({ where: { nguon: 'drive' }, select: { nguonId: true } }))
                .map((x: any) => x.nguonId).filter(Boolean),
        )

        res.json({
            success: true,
            data: {
                items: files
                    .filter(f => !daCo.has(f.id))
                    .map(f => ({
                        driveId: f.id,
                        ten: f.name,
                        mime: f.mimeType,
                        bytes: f.size ? Number(f.size) : null,
                        thoiLuongS: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) / 1000 : null,
                        rong: f.videoMediaMetadata?.width ?? null,
                        cao: f.videoMediaMetadata?.height ?? null,
                        anhBia: f.thumbnailLink || null,
                        taoLuc: f.createdTime || null,
                    })),
                daCoTrongKho: daCo.size,
                chamTran: files.length >= 200,
            },
        })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('GET /san-media/drive lỗi:', err)
        // Lỗi Drive phải hiện NGUYÊN VĂN: "chưa share thư mục" và "sai folderId" là
        // hai chuyện khác nhau, che thành "lỗi hệ thống" là không sửa được.
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được thư mục Drive') })
    }
})

// ─── Thêm vào kho ──────────────────────────────────────────────────────────────
router.post('/', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const b = req.body || {}
        const nguon = NGUON.includes(b.nguon) ? b.nguon : 'drive'
        if (nguon === 'drive' && !b.nguonId) { res.status(400).json({ success: false, error: 'Thiếu nguonId (fileId của Drive)' }); return }
        if (nguon === 'lien_ket' && !b.lienKet) { res.status(400).json({ success: false, error: 'Thiếu lienKet' }); return }

        // Cùng một file Drive thêm hai lần là hai dòng trùng — chặn ngay từ đầu.
        if (nguon === 'drive') {
            const da = await prisma.sanMedia.findFirst({ where: { nguon: 'drive', nguonId: String(b.nguonId) }, select: { id: true, ten: true } })
            if (da) { res.status(409).json({ success: false, error: `Video này đã có trong kho: ${da.ten}`, id: da.id }); return }
        }

        const m = await prisma.sanMedia.create({
            data: {
                ten: String(b.ten || 'Video chưa đặt tên').slice(0, 200),
                nguon,
                nguonId: nguon === 'drive' ? String(b.nguonId) : null,
                lienKet: nguon === 'lien_ket' ? String(b.lienKet) : null,
                mime: b.mime ? String(b.mime) : null,
                bytes: b.bytes != null ? Math.round(Number(b.bytes)) || null : null,
                thoiLuongS: b.thoiLuongS != null ? Number(b.thoiLuongS) || null : null,
                anhBia: b.anhBia ? String(b.anhBia) : null,
                caption: b.caption ? String(b.caption).slice(0, 2000) : null,
                kenh: KENH.includes(b.kenh) ? b.kenh : null,
                channelId: b.channelId ? String(b.channelId) : null,
                henDangLuc: b.henDangLuc ? new Date(b.henDangLuc) : null,
                trangThai: 'nhap',
                createdBy: req.user?.userId || null,
            },
        })

        // Gắn SKU ngay lúc tạo nếu người dùng đã nhập
        const skus: string[] = Array.isArray(b.skus) ? b.skus : []
        if (skus.length) await ganSku(prisma, m.id, b.channelId ? String(b.channelId) : null, skus, b.nhan || {})

        const day = await prisma.sanMedia.findUnique({ where: { id: m.id }, include: { sanPham: { orderBy: { thuTu: 'asc' } } } })
        res.json({ success: true, data: day })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('POST /san-media lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không thêm được vào kho media') })
    }
})

// ─── Sửa ───────────────────────────────────────────────────────────────────────
router.patch('/:id', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const b = req.body || {}
        const data: any = {}
        if (b.ten !== undefined) data.ten = String(b.ten).slice(0, 200)
        if (b.caption !== undefined) data.caption = b.caption ? String(b.caption).slice(0, 2000) : null
        if (b.kenh !== undefined) data.kenh = KENH.includes(b.kenh) ? b.kenh : null
        if (b.channelId !== undefined) data.channelId = b.channelId ? String(b.channelId) : null
        if (b.henDangLuc !== undefined) {
            /* Hẹn giờ vào QUÁ KHỨ là bẫy im lặng: người dùng tưởng đã đặt lịch, bộ chạy
             * nền thấy tới giờ rồi nên đăng ngay lập tức. Chặn ở đây, nói rõ. */
            if (b.henDangLuc) {
                const t = new Date(b.henDangLuc)
                if (isNaN(t.getTime())) { res.status(400).json({ success: false, error: 'henDangLuc không đọc được' }); return }
                if (t.getTime() < Date.now() - 60_000) { res.status(400).json({ success: false, error: 'Giờ hẹn đã trôi qua. Chọn giờ trong tương lai, hoặc bỏ trống để đăng ngay.' }); return }
                data.henDangLuc = t
            } else data.henDangLuc = null
        }
        if (b.trangThai !== undefined) {
            /* KHÔNG cho tay người đặt 'da_dang'. Cờ đó chỉ đúng khi SÀN trả về mã
             * video; cho phép đánh dấu tay là mở đường cho một kho toàn video "đã
             * đăng" mà trên sàn chẳng có gì. */
            if (b.trangThai === 'da_dang') {
                res.status(400).json({ success: false, error: '"Đã đăng" chỉ được đặt khi sàn trả về mã video, không đánh dấu tay được.' })
                return
            }
            if (!TRANG_THAI.includes(b.trangThai)) { res.status(400).json({ success: false, error: 'trangThai không hợp lệ' }); return }
            data.trangThai = b.trangThai
        }
        if (!Object.keys(data).length) { res.status(400).json({ success: false, error: 'Không có gì để sửa' }); return }

        const m = await prisma.sanMedia.update({ where: { id: String(req.params.id) }, data })

        /* Đổi gian hàng thì mọi mã sản phẩm đã tra PHẢI tra lại: cùng SKU ở gian hàng
         * khác là mã listing khác. Giữ mã cũ là gắn nhầm sản phẩm của shop khác. */
        if (b.skus !== undefined || b.channelId !== undefined) {
            const skus: string[] = Array.isArray(b.skus)
                ? b.skus
                : (await prisma.sanMediaSanPham.findMany({ where: { mediaId: m.id }, select: { sku: true } })).map((x: any) => x.sku)
            await ganSku(prisma, m.id, m.channelId || null, skus, b.nhan || {})
        }

        const day = await prisma.sanMedia.findUnique({ where: { id: m.id }, include: { sanPham: { orderBy: { thuTu: 'asc' } } } })
        res.json({ success: true, data: day })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('PATCH /san-media lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không sửa được') })
    }
})

// ─── Xoá khỏi kho (KHÔNG đụng file trên Drive) ─────────────────────────────────
router.delete('/:id', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const m = await prisma.sanMedia.findUnique({ where: { id: String(req.params.id) }, select: { trangThai: true, maTrenSan: true } })
        if (!m) { res.status(404).json({ success: false, error: 'Không thấy media' }); return }
        /* Đã đăng lên sàn rồi thì xoá dòng ở đây KHÔNG gỡ video trên sàn — nói rõ,
         * đừng để chủ shop tưởng đã gỡ. */
        await prisma.sanMedia.delete({ where: { id: String(req.params.id) } })
        res.json({
            success: true,
            data: {
                daXoaKhoiKho: true,
                canhBao: m.trangThai === 'da_dang'
                    ? `Video vẫn còn TRÊN SÀN (mã ${m.maTrenSan || '?'}) — xoá ở đây chỉ bỏ khỏi kho, phải vào sàn gỡ riêng.`
                    : null,
                ghiChu: 'File gốc trên Google Drive giữ nguyên.',
            },
        })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('DELETE /san-media lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không xoá được') })
    }
})

// ─── Đăng lên sàn còn thiếu gì ─────────────────────────────────────────────────
router.get('/san-sang', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const kenhDs = await prisma.onlineChannel.findMany({
            where: { status: 'active' },
            select: { platform: true, name: true, accessToken: true },
        }).catch(() => [])
        const coKenh = (p: string) => kenhDs.some((c: any) => c.platform === p && c.accessToken)

        res.json({
            success: true,
            data: {
                /* Nói ĐÚNG cái đang thiếu. "Chưa hỗ trợ" là câu vô dụng: chủ shop không
                 * biết phải làm gì tiếp, còn người sửa sau không biết còn bao xa. */
                shopee: {
                    dangDuoc: false,
                    daNoiKenhBanHang: coKenh('shopee'),
                    conThieu: [
                        'Ứng dụng phải đăng ký thêm loại "Shopee Video Management" trong Shopee Open Platform console.',
                        'Phải uỷ quyền lại theo kiểu USER: API video ký bằng user_id chứ không phải shop_id (auth_type=seller thì get_access_token trả về cả hai).',
                        'Cửa hàng phải đồng ý Điều khoản Shopee Video trong Seller Center.',
                    ],
                    duongApi: ['v2.media.init_video_upload', 'v2.media.upload_video_part', 'v2.media.complete_video_upload', 'v2.video.get_cover_list', 'v2.video.edit_video_info', 'v2.video.post_video'],
                    gioiHan: GIOI_HAN.shopee,
                },
                tiktok: {
                    dangDuoc: false,
                    daNoiKenhBanHang: coKenh('tiktok'),
                    conThieu: [
                        'Cần scope creator.video.write và token CREATOR (user_type=1) — token TikTok Shop đang dùng để lấy đơn KHÔNG dùng lại được.',
                        'Chủ tài khoản TikTok phải uỷ quyền riêng cho ứng dụng theo luồng creator.',
                    ],
                    duongApi: ['POST /affiliate_creator/202505/videos/video_files', 'POST /affiliate_creator/202603/videos'],
                    gioiHan: GIOI_HAN.tiktok,
                },
                tomTat: 'Kho media dùng được ngay. Nút đăng thẳng lên sàn CHƯA bật vì cả hai sàn đòi một luồng uỷ quyền riêng, khác token bán hàng hiện có.',
            },
        })
    } catch (err: any) {
        console.error('GET /san-media/san-sang lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được tình trạng') })
    }
})

export default router
