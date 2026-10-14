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

import express, { Router, Request, Response } from 'express'
import { errMsg } from '../lib/errorResponse'
import { duongXem, kiemXem } from '../lib/linkXemVideo'
import { getStorePrisma } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'

const router = Router()

/* 'hen_gio' (14/10/2026) = KENGI giữ lịch: máy chủ tự đăng đúng giờ (lib/henGioDangVideo.ts), khác
 * 'da_len_lich' = SÀN đã nhận lịch (Shopee scheduled_post, có mã trên sàn). */
const TRANG_THAI = ['nhap', 'da_len_lich', 'cho_dang', 'da_dang', 'loi', 'hen_gio'] as const
const KENH = ['shopee', 'tiktok'] as const
const NGUON = ['drive', 'lien_ket'] as const

/** Giới hạn của từng sàn — lấy từ tài liệu gốc, để kiểm TRƯỚC khi tốn công tải lên. */
const GIOI_HAN = {
    shopee: { giayToiThieu: 1, giayToiDa: 180, byteToiDa: 1024 * 1024 * 1024, ghiChu: 'Shopee Video: 1–180 giây, tối đa 1GB.' },
    tiktok: { giayToiThieu: 1, giayToiDa: 600, byteToiDa: 4 * 1024 * 1024 * 1024, ghiChu: 'TikTok Content Posting API: tối đa 4GB, tải theo khối 10MB. Tỉ lệ 9:16 đến 16:9, khuyến nghị 720p.' },
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

const gioVN = (d: Date | string) => new Date(d).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
})

/** Hạn giữ chỗ chạy máy đăng còn sống không (đọc từ tienTrinhDang — xem dangVideoShopee.chayBuocDangShopee). */
function dangCoNguoiChay(tienTrinhDang?: string | null): boolean {
    try {
        const t = tienTrinhDang ? JSON.parse(tienTrinhDang) : null
        return !!t?.dangChayDen && Date.parse(t.dangChayDen) > Date.now()
    } catch { return false }
}

/** Video đang HẸN GIỜ thì web không được đăng tay — máy chạy theo lịch là người duy nhất chạy nó,
 *  hai người cùng chạy là đăng hai lần. Trả true nếu đã trả lời 409. */
async function dangHenGio(prisma: any, id: string, res: Response): Promise<boolean> {
    const m = await prisma.sanMedia.findUnique({ where: { id }, select: { trangThai: true, henDangLuc: true } }).catch(() => null)
    if (m?.trangThai !== 'hen_gio') return false
    res.status(409).json({
        success: false,
        error: `Video đang hẹn đăng lúc ${m.henDangLuc ? gioVN(m.henDangLuc) : '?'} — máy chủ sẽ tự đăng. Muốn đăng ngay thì bấm "Bỏ hẹn" trước.`,
    })
    return true
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

        /* Đọc BẰNG TÀI KHOẢN CHỦ SHOP nếu đã nối, không thì rơi về tài khoản hệ
         * thống. Bản đầu dùng thẳng tài khoản hệ thống nên cửa hàng đã nối Drive
         * riêng vẫn thấy bảng trống — thư mục trong My Drive của chủ shop thì tài
         * khoản hệ thống không nhìn thấy trừ khi được share tay. Đường GHI
         * (/tai-len) vốn đã ưu tiên chủ shop; hai đường phải cùng một tài khoản,
         * lệch nhau là "tải lên xong mà không thấy đâu". */
        const { getStoreDriveWriter } = await import('../lib/driveOAuth')
        const { drive } = await getStoreDriveWriter(prisma)

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
                // `f: any` vì getStoreDriveWriter trả client kiểu any (nó phải
                // nhận cả client OAuth lẫn client service account).
                items: files
                    .filter((f: any) => !daCo.has(f.id))
                    .map((f: any) => ({
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

/* ─── XEM LẠI VIDEO (14/10/2026, chủ shop: "không xem lại video được à") ─────────────────
 *
 * Video nằm ở Drive cửa hàng. Thẻ <video> KHÔNG gửi được header Authorization ⇒ hai bước:
 *   1. GET /:id/xem-link  (đăng nhập)  → đường phát ký HMAC, sống 30 phút, gắn đúng schema + id
 *   2. GET /xem/:id?s&h&k (không đăng nhập, chữ ký thay) → chuyển byte Drive theo Range, mỗi lượt ≤ 8MB
 *      (tua được; Cloud Run không phải giữ cả file 1GB trong một phản hồi). Nhân viên không cần đăng nhập Google.
 * Không đưa JWT đăng nhập vào URL — link chỉ mở được đúng một video, hết hạn sau 30 phút.
 * helmet đặt Cross-Origin-Resource-Policy: same-origin ⇒ thẻ <video> ở kengi.vn bị chặn khi tải từ
 * api.kengi.vn; đường phát đặt lại 'same-site' (kengi.vn và api.kengi.vn cùng site). */
const KHOI_XEM = 8 * 1024 * 1024
const driveXemCache = new Map<string, { drive: any; luc: number }>()

router.get('/:id/xem-link', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const schema = req.user?.branchSchema || req.user?.storeSchema || ''
        if (!/^[a-z0-9_]+$/.test(schema)) { res.status(400).json({ success: false, error: 'Thiếu cửa hàng trong phiên đăng nhập' }); return }
        const m = await prisma.sanMedia.findUnique({ where: { id: String(req.params.id) }, select: { id: true, nguon: true, nguonId: true, lienKet: true } })
        if (!m) { res.status(404).json({ success: false, error: 'Không thấy video' }); return }
        if (m.nguon === 'lien_ket') { res.json({ success: true, data: { ngoai: m.lienKet } }); return }
        if (!m.nguonId) { res.status(400).json({ success: false, error: 'Video này không có file Drive' }); return }
        const { duong, het } = duongXem(schema, m.id)
        res.json({ success: true, data: { duong, drive: `https://drive.google.com/file/d/${encodeURIComponent(m.nguonId)}/view`, het } })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('GET /san-media/:id/xem-link lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không tạo được link xem') })
    }
})

router.get('/xem/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || ''), schema = String(req.query.s || ''), het = Number(req.query.h) || 0, k = String(req.query.k || '')
    try {
        const kq = kiemXem(schema, id, het, k)
        if (kq === 'sai') { res.status(403).json({ success: false, error: 'Link xem không hợp lệ' }); return }
        if (kq === 'het-han') { res.status(403).json({ success: false, error: 'Link xem đã hết hạn — mở lại video' }); return }
        const prisma: any = getStorePrisma(schema)
        const m = await prisma.sanMedia.findUnique({ where: { id }, select: { nguonId: true, mime: true, bytes: true } })
        if (!m?.nguonId) { res.status(404).json({ success: false, error: 'Không thấy video' }); return }
        // Giữ client Drive 10 phút mỗi cửa hàng: tạo mới mỗi khúc Range là mỗi lần xin lại access token
        // (đo 14/10: khúc đầu 6 giây). Client googleapis tự giữ + làm mới token bên trong.
        let dc = driveXemCache.get(schema)
        if (!dc || Date.now() - dc.luc > 10 * 60 * 1000) {
            const { getStoreDriveWriter } = await import('../lib/driveOAuth')
            dc = { drive: (await getStoreDriveWriter(prisma)).drive, luc: Date.now() }
            driveXemCache.set(schema, dc)
        }
        const drive = dc.drive
        let co = Number(m.bytes) || 0, loai = m.mime || ''
        if (!co || !loai) {
            const meta = await drive.files.get({ fileId: m.nguonId, fields: 'size,mimeType', supportsAllDrives: true })
            co = co || Number(meta.data?.size) || 0
            loai = loai || meta.data?.mimeType || 'video/mp4'
        }
        if (!co) { res.status(502).json({ success: false, error: 'Drive không trả dung lượng file' }); return }
        // Range: "bytes=X-" / "bytes=X-Y" — mỗi lượt tối đa 8MB, trình duyệt tự xin tiếp
        const r = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || 'bytes=0-'))
        let tu = r ? Number(r[1]) : 0
        let den = r && r[2] ? Math.min(Number(r[2]), co - 1) : co - 1
        if (tu >= co) { res.status(416).setHeader('Content-Range', `bytes */${co}`); res.end(); return }
        if (den - tu + 1 > KHOI_XEM) den = tu + KHOI_XEM - 1
        const dl = await drive.files.get(
            { fileId: m.nguonId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream', headers: { Range: `bytes=${tu}-${den}` } },
        )
        res.status(206)
        res.setHeader('Content-Type', loai || 'video/mp4')
        res.setHeader('Content-Length', String(den - tu + 1))
        res.setHeader('Content-Range', `bytes ${tu}-${den}/${co}`)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Cache-Control', 'private, max-age=1800')
        res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
        const luong: any = dl.data
        luong.on('error', (e: any) => { console.error('[xem-video] luồng Drive gãy:', e?.message || e); res.destroy(e) })
        req.on('close', () => { try { luong.destroy() } catch { /* đã đóng */ } })
        luong.pipe(res)
    } catch (err: any) {
        console.error('GET /san-media/xem/:id lỗi:', err?.message || err)
        if (!res.headersSent) res.status(502).json({ success: false, error: String(err?.message || err).slice(0, 300) })
        else res.destroy()
    }
})

/* ─── TẢI VIDEO THẲNG TỪ MÁY LÊN ────────────────────────────────────────────────
 *
 * Byte KHÔNG đi qua máy chủ mình. Cloud Run chặn thân yêu cầu ở 32MB, mà Shopee
 * Video cho tới 1GB — proxy là tắc ngay từ file thứ nhất. Đường đi:
 *
 *   1. Trình duyệt xin mở phiên  →  ĐIỂM NÀY (mở phiên nối tiếp trên Drive)
 *   2. Trình duyệt PUT thẳng byte lên URL phiên Google trả về (có tiến độ, ngắt
 *      giữa chừng thì PUT tiếp được)
 *   3. Xong thì gọi POST /san-media với nguon='drive' + fileId vừa nhận
 *
 * Đo 08/09/2026: Google trả `Access-Control-Allow-Origin: https://kengi.vn` và
 * cho phép PUT kèm `content-range` — nên bước 2 chạy được từ trình duyệt.
 *
 * File rơi vào ĐÚNG thư mục Drive đã khai ở Cài đặt, nên nó cũng hiện luôn trong
 * bảng "Thêm video từ Drive" — một chỗ chứa, không đẻ ra chỗ thứ hai.
 */
router.post('/tai-len', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const b = req.body || {}
        const ten = String(b.ten || '').trim()
        const mime = String(b.mime || '').trim()
        const bytes = Math.round(Number(b.bytes) || 0)

        if (!ten) { res.status(400).json({ success: false, error: 'Thiếu tên file' }); return }
        if (!/^video\//i.test(mime) && !/^image\//i.test(mime)) {
            res.status(400).json({ success: false, error: `Chỉ nhận video hoặc ảnh. File này là "${mime || 'không rõ'}".` })
            return
        }
        if (bytes <= 0) { res.status(400).json({ success: false, error: 'Không đọc được dung lượng file' }); return }
        // Trần 2GB: trên mức này thì cả hai sàn đều không nhận, chặn sớm còn hơn
        // để chủ shop ngồi chờ tải 40 phút rồi mới báo hỏng.
        if (bytes > 2 * 1024 * 1024 * 1024) {
            res.status(400).json({ success: false, error: 'File lớn hơn 2GB. Shopee Video tối đa 1GB — nén lại trước đã.' })
            return
        }

        const cai = await prisma.storeSettings.findFirst({ select: { driveFolderId: true } as any }) as any
        const folderId = cai?.driveFolderId || null
        if (!folderId) {
            res.status(400).json({
                success: false,
                error: 'Chưa chọn thư mục Google Drive. Vào Cài đặt → Google Drive, chọn thư mục chứa video rồi tải lên lại.',
            })
            return
        }

        const { layTokenGhiDrive } = await import('../lib/driveOAuth')
        const { moPhienResumable, KICH_THUOC_KHOI } = await import('../lib/driveChunkUpload')
        const { token, nguon, email } = await layTokenGhiDrive(prisma)

        let duongTaiLen: string
        try {
            duongTaiLen = await moPhienResumable(token, folderId, ten, mime, bytes)
        } catch (e: any) {
            /* Lỗi của Google hiện NGUYÊN VĂN kèm ĐANG GHI BẰNG TÀI KHOẢN NÀO —
             * "thư mục không tồn tại" và "không có quyền ghi" là hai chuyện khác
             * nhau, và tài khoản hệ thống chưa được share thư mục cũng ra lỗi này. */
            res.status(502).json({
                success: false,
                error: `${String(e?.message || e)} (đang ghi bằng ${nguon === 'chu-shop' ? `tài khoản ${email || 'chủ shop'}` : 'tài khoản hệ thống'})`,
            })
            return
        }

        res.json({
            success: true,
            data: {
                duongTaiLen,
                nguonQuyen: nguon,
                email: email || null,
                kichThuocKhoi: KICH_THUOC_KHOI,
                ghiChu: 'Trình duyệt cắt file thành khối rồi POST từng khối lên /san-media/tai-len/chunk (kèm header X-Upload-Url = duongTaiLen). Máy chủ chuyển tiếp vào Google. Khối cuối trả file.id → gọi POST /san-media với nguon="drive".',
            },
        })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('POST /san-media/tai-len lỗi:', err)
        // Nguyên văn: "Google không cấp access token — kết nối lại Drive" phải tới được chủ shop.
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 400) || 'Không mở được phiên tải lên' })
    }
})

/* ─── NHẬN MỘT KHỐI, CHUYỂN TIẾP LÊN GOOGLE ─────────────────────────────────────
 * Thân yêu cầu là byte thô (application/octet-stream) → express.raw. Header mang
 * URL phiên + vị trí khối. Không đọc DB, không cần storePrisma — chỉ chuyển tiếp,
 * nên nhẹ và nhanh. SSRF chặn ở guiKhoiResumable (host phải là googleapis.com). */
router.post('/tai-len/chunk',
    authMiddleware,
    requirePermission('online_orders.edit', 'online_orders.view'),
    express.raw({ type: () => true, limit: '24mb' }),
    async (req: AuthRequest, res: Response) => {
        try {
            const url = String(req.headers['x-upload-url'] || '')
            const offset = Math.round(Number(req.headers['x-chunk-offset']))
            const total = Math.round(Number(req.headers['x-chunk-total']))
            const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([])

            if (!url) { res.status(400).json({ success: false, error: 'Thiếu X-Upload-Url' }); return }
            if (!Number.isFinite(offset) || offset < 0) { res.status(400).json({ success: false, error: 'X-Chunk-Offset không hợp lệ' }); return }
            if (!Number.isFinite(total) || total <= 0) { res.status(400).json({ success: false, error: 'X-Chunk-Total không hợp lệ' }); return }
            if (buf.length === 0) { res.status(400).json({ success: false, error: 'Khối rỗng' }); return }

            const { guiKhoiResumable } = await import('../lib/driveChunkUpload')
            const kq = await guiKhoiResumable(url, new Uint8Array(buf), offset, total)

            if (kq.xong) {
                const fileId = kq.file?.id || null
                if (!fileId) { res.status(502).json({ success: false, error: 'Google báo xong nhưng không trả id file' }); return }
                res.json({ success: true, data: { xong: true, fileId, ten: kq.file?.name || null } })
            } else {
                res.json({ success: true, data: { xong: false, daNhan: kq.daNhan ?? offset + buf.length } })
            }
        } catch (err: any) {
            console.error('POST /san-media/tai-len/chunk lỗi:', err?.message || err)
            res.status(502).json({ success: false, error: String(err?.message || err).slice(0, 400) })
        }
    })

/* ─── ĐĂNG LÊN SHOPEE VIDEO — một bước mỗi lần gọi ──────────────────────────────
 * Xem lib/dangVideoShopee.ts vì sao theo bước. Web gọi lặp tới khi `xong`.
 * Lỗi của Shopee trả NGUYÊN VĂN: "copyright_not_agree" (chưa đồng ý điều khoản)
 * và "unauthorized" (chưa được bật) là hai việc khác nhau chủ shop phải tự làm. */
router.post('/:id/dang-shopee', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { chayBuocDangShopee } = await import('../lib/dangVideoShopee')
        /* 75s chứ không 200s: chủ shop nhìn 'Bắt đầu…' đứng im 3 phút tưởng treo (08/09).
         * Lượt ngắn = web nhận tiến trình thường xuyên; trạng thái vẫn nằm ở DB. */
        const nganSach = Math.min(240_000, Math.max(20_000, Number(req.body?.nganSachMs) || 75_000))
        if (await dangHenGio(prisma, String(req.params.id), res)) return
        /* Qua GIỮ CHỖ (11/10/2026): máy chủ có thể đang tự đăng nốt sau push 38 của app Video —
         * hai lượt song song là post_video hai lần. Bận thì đợi một nhịp rồi trả conTiep; web gọi
         * lặp ngay nên không đợi là dội máy chủ. */
        const kq = await chayBuocDangShopee(prisma, String(req.params.id), nganSach, 'web')
        if (kq.banBan) await new Promise(r => setTimeout(r, 4000))
        res.json({ success: true, data: kq })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('POST /san-media/:id/dang-shopee lỗi:', err?.message || err)
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 600) })
    }
})

/* ─── ĐĂNG LÊN TIKTOK — cũng một bước mỗi lần gọi ───────────────────────────────
 * `dangThang` false (mặc định) = thả vào HỘP THƯ TikTok, chủ tài khoản mở app bấm
 * hoàn tất. true = đăng thẳng, cần quyền video.publish VÀ ứng dụng đã qua kiểm
 * duyệt, nếu chưa thì TikTok để video ở chế độ chỉ mình xem. */
router.post('/:id/dang-tiktok', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { buocDangTikTok } = await import('../lib/dangVideoTikTok')
        const nganSachMs = Math.min(240_000, Math.max(20_000, Number(req.body?.nganSachMs) || 75_000))
        if (await dangHenGio(prisma, String(req.params.id), res)) return
        const kq = await buocDangTikTok(prisma, String(req.params.id), {
            dangThang: req.body?.dangThang === true,
            nganSachMs,
        })
        res.json({ success: true, data: kq })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('POST /san-media/:id/dang-tiktok lỗi:', err?.message || err)
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 600) })
    }
})

/* ─── HẸN GIỜ ĐĂNG (14/10/2026) ──────────────────────────────────────────────────
 * Chủ shop: "chưa có hẹn giờ đăng". Bản trước chỉ có ô giờ trong form Sửa, lưu xong gắn nhãn
 * 'da_len_lich' mà không gửi gì lên sàn ⇒ video nằm im mãi. Nay hẹn = trạng thái 'hen_gio', máy chủ
 * tự chạy ở nhịp ngoài /api/cron/tick (lib/henGioDangVideo.ts), không cần mở trang:
 *   · Shopee: tải lên NGAY; giờ hẹn cách ≥16 phút thì Shopee giữ video và tự đăng đúng giờ
 *     (scheduled_info, khung 15 phút–30 ngày), gần hơn thì máy chủ đợi tới giờ mới post_video.
 *   · TikTok: Content Posting API không có hẹn giờ ⇒ tới giờ máy chủ mới bắt đầu tải + đăng.
 * Kiểm đủ điều kiện NGAY lúc hẹn — để tới giờ mới vỡ là hỏng lời hứa với chủ shop. */
router.post('/:id/hen-gio', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = String(req.params.id)
        const m = await prisma.sanMedia.findUnique({ where: { id } })
        if (!m) { res.status(404).json({ success: false, error: 'Không thấy video' }); return }
        if (m.trangThai === 'da_dang' || m.trangThai === 'da_len_lich') {
            res.status(400).json({ success: false, error: 'Video này đã lên sàn rồi.' }); return
        }
        if (m.kenh !== 'shopee' && m.kenh !== 'tiktok') {
            res.status(400).json({ success: false, error: 'Chưa chọn kênh đăng — bấm Sửa, chọn Shopee hoặc TikTok trước.' }); return
        }
        if (m.nguon !== 'drive' || !m.nguonId) {
            res.status(400).json({ success: false, error: 'Chỉ hẹn được video nằm trong Drive của cửa hàng.' }); return
        }
        const t = new Date(req.body?.henDangLuc)
        if (isNaN(t.getTime())) { res.status(400).json({ success: false, error: 'Chưa chọn giờ đăng.' }); return }
        if (t.getTime() < Date.now() + 2 * 60_000) {
            res.status(400).json({ success: false, error: 'Giờ hẹn phải sau bây giờ ít nhất 2 phút. Muốn đăng liền thì bấm nút Đăng.' }); return
        }
        if (t.getTime() > Date.now() + 30 * 86400_000) {
            res.status(400).json({ success: false, error: 'Chỉ hẹn được trong vòng 30 ngày (Shopee giới hạn 30 ngày; refresh token video cũng sống 30 ngày).' }); return
        }
        if (dangCoNguoiChay(m.tienTrinhDang)) {
            res.status(409).json({ success: false, error: 'Video đang được đăng ở cửa sổ khác — đợi lượt đó xong.' }); return
        }

        const dangThang = req.body?.dangThang === true
        let tienTrinhDang: string | null = m.tienTrinhDang ?? null
        let san: any = null
        try { san = m.tienTrinhDang ? JSON.parse(m.tienTrinhDang)?.san : null } catch { san = null }
        if (m.kenh === 'shopee') {
            if (m.coNoiDungAI !== true && m.coNoiDungAI !== false) {
                res.status(400).json({ success: false, error: 'Chưa khai video có dùng AI hay không — Shopee bắt buộc. Chọn "Có AI" / "Không AI" dưới tên video trước.' }); return
            }
            if (!m.channelId) { res.status(400).json({ success: false, error: 'Chưa chọn gian hàng Shopee — bấm Sửa, chọn gian trước.' }); return }
            const ch = await prisma.onlineChannel.findUnique({ where: { id: m.channelId }, select: { name: true, videoUserId: true } as any })
            if (!ch?.videoUserId) {
                res.status(400).json({ success: false, error: `Gian "${ch?.name || '?'}" chưa uỷ quyền Shopee Video — uỷ quyền ở ô vàng đầu trang trước khi hẹn.` }); return
            }
            // Tiến trình đang là của TikTok (đổi kênh) ⇒ bỏ, để máy đăng Shopee giữ chỗ được trên dòng
            if (san && san !== 'shopee') tienTrinhDang = null
        } else {
            const st = await prisma.storeSettings.findFirst({ select: { ttPostOpenId: true, ttPostScopes: true } as any }).catch(() => null)
            const sc = String(st?.ttPostScopes || '').split(',').map((s: string) => s.trim())
            if (!st?.ttPostOpenId) { res.status(400).json({ success: false, error: 'Chưa kết nối tài khoản TikTok — bấm "Kết nối TikTok" ở ô vàng đầu trang.' }); return }
            if (dangThang && !sc.includes('video.publish')) { res.status(400).json({ success: false, error: 'Tài khoản TikTok chưa cấp quyền đăng thẳng (video.publish) — bỏ chọn "đăng thẳng" hoặc kết nối lại có bật.' }); return }
            if (!dangThang && !sc.includes('video.upload')) { res.status(400).json({ success: false, error: 'Tài khoản TikTok chưa cấp quyền video.upload — kết nối lại TikTok.' }); return }
            // Lời chọn đăng thẳng/hộp thư nằm trong tiến trình TikTok để máy chạy đọc lại lúc tới giờ
            let tt: any = null
            try { tt = san === 'tiktok' ? JSON.parse(m.tienTrinhDang) : null } catch { tt = null }
            tienTrinhDang = JSON.stringify({ ...(tt || { giaiDoan: 'init' }), san: 'tiktok', dangThang })
        }

        const day = await prisma.sanMedia.update({
            where: { id },
            data: { henDangLuc: t, trangThai: 'hen_gio', loiCuoi: null, tienTrinhDang },
            include: { sanPham: { orderBy: { thuTu: 'asc' } } },
        })
        const conPhut = Math.round((t.getTime() - Date.now()) / 60_000)
        res.json({
            success: true,
            data: {
                media: day,
                ghiChu: m.kenh === 'shopee'
                    ? (conPhut >= 16
                        ? `Máy chủ bắt đầu tải video lên Shopee ngay; Shopee giữ và tự đăng lúc ${gioVN(t)}.`
                        : `Máy chủ tải video lên Shopee ngay rồi đợi tới ${gioVN(t)} mới đăng.`)
                    : `Tới ${gioVN(t)} máy chủ bắt đầu tải lên TikTok${dangThang ? ' và đăng thẳng' : ' (vào hộp thư TikTok — mở app bấm hoàn tất)'}; video lên trễ vài phút tuỳ dung lượng.`,
            },
        })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('POST /san-media/:id/hen-gio lỗi:', err?.message || err)
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 400) })
    }
})

router.delete('/:id/hen-gio', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = String(req.params.id)
        const m = await prisma.sanMedia.findUnique({ where: { id }, select: { trangThai: true, tienTrinhDang: true } })
        if (!m) { res.status(404).json({ success: false, error: 'Không thấy video' }); return }
        if (m.trangThai !== 'hen_gio') { res.status(400).json({ success: false, error: 'Video không ở trạng thái hẹn giờ.' }); return }
        /* Máy chạy đang tải giữa chừng: bỏ hẹn lúc này mà lượt đó chạy tới post_video là vẫn đăng.
         * Bắt đợi hạn giữ chỗ hết (≤ ngân sách lượt + 60 giây) cho chắc. */
        if (dangCoNguoiChay(m.tienTrinhDang)) {
            res.status(409).json({ success: false, error: 'Máy chủ đang tải video theo lịch — đợi 1–2 phút rồi bấm Bỏ hẹn lại.' }); return
        }
        let giaiDoan = 'init'
        try { giaiDoan = m.tienTrinhDang ? (JSON.parse(m.tienTrinhDang)?.giaiDoan || 'init') : 'init' } catch { giaiDoan = 'init' }
        const day = await prisma.sanMedia.update({
            where: { id },
            // Đã tải được một phần thì để 'cho_dang' — nút "Tiếp tục đăng" chạy tiếp, không tải lại
            data: { trangThai: giaiDoan !== 'init' ? 'cho_dang' : 'nhap', henDangLuc: null },
            include: { sanPham: { orderBy: { thuTu: 'asc' } } },
        })
        res.json({ success: true, data: { media: day } })
    } catch (err: any) {
        if (laThieuBang(err)) { res.status(503).json(loiThieuBang); return }
        console.error('DELETE /san-media/:id/hen-gio lỗi:', err?.message || err)
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 400) })
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
                // Chỉ nhận true/false do NGƯỜI ĐĂNG chọn — thiếu là null (chưa khai), không đoán
                coNoiDungAI: typeof b.coNoiDungAI === 'boolean' ? b.coNoiDungAI : null,
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
        const hienTai = await prisma.sanMedia.findUnique({ where: { id: String(req.params.id) }, select: { trangThai: true } })
        if (!hienTai) { res.status(404).json({ success: false, error: 'Không thấy media' }); return }
        if (b.ten !== undefined) data.ten = String(b.ten).slice(0, 200)
        if (b.caption !== undefined) data.caption = b.caption ? String(b.caption).slice(0, 2000) : null
        if (b.kenh !== undefined) data.kenh = KENH.includes(b.kenh) ? b.kenh : null
        if (b.channelId !== undefined) data.channelId = b.channelId ? String(b.channelId) : null
        /* Khai nội dung AI — Shopee bắt buộc aigc_label (09/10/2026). true/false là lời
         * khai của người đăng; null = rút lại về "chưa khai". */
        if (b.coNoiDungAI !== undefined) data.coNoiDungAI = typeof b.coNoiDungAI === 'boolean' ? b.coNoiDungAI : null
        /* GIỜ HẸN chỉ đặt qua POST /:id/hen-gio (14/10/2026). Form Sửa cũ gửi kèm trangThai 'da_len_lich'
         * ⇒ video mang nhãn "Đã lên lịch" mà KHÔNG gì gửi lên sàn, nút Đăng biến mất, máy đăng coi là xong:
         * hẹn giờ giả. Video đang hẹn thì đổi giờ qua nút Hẹn giờ (máy chạy giữ chỗ theo giờ đó). */
        if (b.henDangLuc !== undefined && hienTai.trangThai === 'hen_gio') {
            res.status(400).json({ success: false, error: 'Video đang hẹn giờ — đổi giờ bằng nút "Hẹn giờ" ở dòng video (hoặc Bỏ hẹn).' })
            return
        }
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
            // 'da_len_lich' = SÀN đã nhận lịch (có mã); 'hen_gio' đặt qua POST /:id/hen-gio để kiểm đủ điều kiện
            if (b.trangThai === 'da_len_lich' || b.trangThai === 'hen_gio') {
                res.status(400).json({ success: false, error: 'Hẹn giờ đăng bằng nút "Hẹn giờ" ở dòng video — không đặt tay trạng thái lịch.' })
                return
            }
            if (['da_dang', 'da_len_lich', 'hen_gio'].includes(hienTai.trangThai) && b.trangThai !== hienTai.trangThai) {
                res.status(400).json({
                    success: false,
                    error: hienTai.trangThai === 'hen_gio' ? 'Video đang hẹn giờ — bấm "Bỏ hẹn" trước.' : 'Video đã lên sàn — không đổi trạng thái được.',
                })
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
        /* Cột video* mới thêm 08/09/2026. Cửa hàng chưa chạy /admin/migrate thì
         * SELECT rộng ném P2022 — rơi về SELECT hẹp và NÓI RA, đừng nuốt thành
         * "chưa nối kênh" (đó là câu sai). */
        let chuaMigrate = false
        let kenhDs: any[] = []
        try {
            kenhDs = await prisma.onlineChannel.findMany({
                where: { status: 'active' },
                select: { id: true, platform: true, name: true, accessToken: true, videoUserId: true, videoAuthAt: true, videoTokenExpiresAt: true, videoRefreshToken: true, videoPartnerId: true, videoPartnerKey: true, videoPushKey: true } as any,
            })
        } catch {
            chuaMigrate = true
            kenhDs = await prisma.onlineChannel.findMany({
                where: { status: 'active' },
                select: { id: true, platform: true, name: true, accessToken: true },
            }).catch(() => [])
        }
        const coKenh = (p: string) => kenhDs.some((c: any) => c.platform === p && c.accessToken)

        /* Cửa hàng có NHIỀU gian hàng Shopee (KENGISTORE có 3: Kengi Tools/Store/
         * Electric). App Video, uỷ quyền, và gian hàng chọn cho video phải bám
         * theo CÙNG MỘT kênh — trước đây mỗi thứ rơi vào một kênh khác nhau nên
         * không kênh nào đủ điều kiện. Trả trạng thái video của TỪNG kênh để web
         * cho chọn, thay vì đoán một kênh. */
        /* App Video là MỘT app cho cả cửa hàng. Gian nào chưa có khoá (lưu khoá từ trước khi có "áp cho mọi
         * gian") thì dùng chung khoá của gian đã có — nút Uỷ quyền chép khoá sang lúc bấm (onlineOrders
         * video-auth-url). Trước 14/10/2026 hai gian Kengi Tools/Electric hiện "Chưa có khoá app Video",
         * nút Uỷ quyền mờ, chủ shop hết đường uỷ quyền. */
        const appChung: any = kenhDs.find((c: any) => c.platform === 'shopee' && c.videoPartnerId && c.videoPartnerKey) || null
        const kenhShopeeDs = kenhDs.filter((c: any) => c.platform === 'shopee').map((c: any) => ({
            id: c.id,
            ten: c.name,
            daNoiBanHang: !!c.accessToken,
            coAppVideo: !!(c.videoPartnerId && c.videoPartnerKey) || !!appChung,
            khoaDungChung: !(c.videoPartnerId && c.videoPartnerKey) && !!appChung,
            videoPartnerId: c.videoPartnerId || appChung?.videoPartnerId || null,
            videoKeyDuoi4: (c.videoPartnerKey || appChung?.videoPartnerKey) ? String(c.videoPartnerKey || appChung.videoPartnerKey).slice(-4) : null,
            // Set Push của app Video (11/10/2026) — khoá riêng của trang Set Push, chỉ trả 4 ký tự cuối
            coPushKey: !!c.videoPushKey,
            pushKeyDuoi4: c.videoPushKey ? String(c.videoPushKey).slice(-4) : null,
            daUyQuyenVideo: !!c.videoUserId,
            videoUserId: c.videoUserId || null,
            videoRefreshHetHan: c.videoAuthAt
                ? new Date(new Date(c.videoAuthAt).getTime() + 30 * 86400_000).toISOString() : null,
        }))
        // Kênh "chính" để hiện tóm tắt: ưu tiên kênh ĐÃ uỷ quyền, rồi kênh có app key.
        const kenhShopee = kenhDs.find((c: any) => c.platform === 'shopee' && c.videoUserId)
            || kenhDs.find((c: any) => c.platform === 'shopee' && c.videoPartnerId)
            || kenhDs.find((c: any) => c.platform === 'shopee' && c.accessToken)
            || kenhDs.find((c: any) => c.platform === 'shopee')
        const daUyQuyenVideo = kenhShopeeDs.some((c: any) => c.daUyQuyenVideo)
        // refresh_token sống 30 ngày kể từ lần uỷ quyền/làm mới gần nhất
        const videoRefreshHetHan = kenhShopee?.videoAuthAt
            ? new Date(new Date(kenhShopee.videoAuthAt).getTime() + 30 * 86400_000).toISOString()
            : null

        /* SET PUSH APP VIDEO (11/10/2026): URL + vùng để dán vào console, và Shopee có đẩy tới chưa —
         * đọc hộp thư webhook (bảng chung, mọi cửa hàng dùng chung một app Video). Đọc hỏng ⇒ null,
         * KHÔNG phải "chưa có push nào". */
        const pushVideo = await (async () => {
            const { URL_PUSH_VIDEO, VUNG_PUSH_VIDEO } = await import('../lib/pushShopeeVideo')
            const goc = { url: URL_PUSH_VIDEO, vung: VUNG_PUSH_VIDEO, maPush: [5, 12, 1, 2, 28, 38] }
            try {
                const { registryPrisma } = await import('../lib/prisma')
                const r: any[] = await registryPrisma.$queryRawUnsafe(
                    `SELECT max("nhanLuc") AS "lanCuoi",
                            count(*) FILTER (WHERE "nhanLuc" > now() - interval '24 hours')::int AS "so24h",
                            count(*) FILTER (WHERE "nhanLuc" > now() - interval '24 hours' AND "trangThai" = 'bo')::int AS "bo24h",
                            count(*) FILTER (WHERE "trangThai" IN ('cho','loi','dang'))::int AS "dangCho"
                       FROM "public"."WebhookInbox" WHERE "platform" = 'shopee-video'`)
                return { ...goc, docDuoc: true, lanCuoi: r[0]?.lanCuoi || null, so24h: r[0]?.so24h ?? 0, bo24h: r[0]?.bo24h ?? 0, dangCho: r[0]?.dangCho ?? 0 }
            } catch {
                return { ...goc, docDuoc: false, lanCuoi: null, so24h: null, bo24h: null, dangCho: null }
            }
        })()

        /* TikTok KHÔNG bám theo OnlineChannel: token gắn với MỘT TÀI KHOẢN TikTok
         * (open_id) chứ không phải gian hàng, nên lưu ở StoreSettings. Cột ttPost*
         * mới thêm 09/09/2026 — chưa migrate thì SELECT ném P2022, phải nói ra. */
        const tt = await (async () => {
            try {
                const c = await prisma.storeSettings.findFirst({
                    select: {
                        ttPostClientKey: true, ttPostClientSecret: true, ttPostOpenId: true,
                        ttPostScopes: true, ttPostDisplayName: true, ttPostAvatar: true, ttPostAuthAt: true,
                    } as any,
                })
                const sc = String(c?.ttPostScopes || '').split(',').map((s: string) => s.trim()).filter(Boolean)
                return {
                    chuaMigrate: false,
                    coApp: !!(c?.ttPostClientKey && c?.ttPostClientSecret),
                    clientKey: c?.ttPostClientKey || null,
                    secretDuoi4: c?.ttPostClientSecret ? String(c.ttPostClientSecret).slice(-4) : null,
                    daKetNoi: !!c?.ttPostOpenId,
                    tenHienThi: c?.ttPostDisplayName || null,
                    anhDaiDien: c?.ttPostAvatar || null,
                    ketNoiLuc: c?.ttPostAuthAt || null,
                    scopeDaCap: sc,
                    coTaiLen: sc.includes('video.upload'),
                    coDangThang: sc.includes('video.publish'),
                }
            } catch {
                return {
                    chuaMigrate: true, coApp: false, clientKey: null, secretDuoi4: null,
                    daKetNoi: false, tenHienThi: null, anhDaiDien: null, ketNoiLuc: null,
                    scopeDaCap: [] as string[], coTaiLen: false, coDangThang: false,
                }
            }
        })()

        res.json({
            success: true,
            data: {
                /* Nói ĐÚNG cái đang thiếu. "Chưa hỗ trợ" là câu vô dụng: chủ shop không
                 * biết phải làm gì tiếp, còn người sửa sau không biết còn bao xa. */
                shopee: {
                    dangDuoc: daUyQuyenVideo,
                    daNoiKenhBanHang: coKenh('shopee'),
                    // Danh sách TỪNG gian hàng Shopee kèm trạng thái video — web dùng cái này.
                    kenhDs: kenhShopeeDs,
                    kenhId: kenhShopee?.id || null,
                    kenhTen: kenhShopee?.name || null,
                    daUyQuyenVideo,
                    videoUserId: kenhShopee?.videoUserId || null,
                    videoUyQuyenLuc: kenhShopee?.videoAuthAt || null,
                    videoRefreshHetHan,
                    /* App Video là app RIÊNG trên console — không trả khoá, chỉ 4 ký tự cuối. */
                    coAppVideo: !!(kenhShopee?.videoPartnerId && kenhShopee?.videoPartnerKey),
                    videoPartnerId: kenhShopee?.videoPartnerId || null,
                    videoKeyDuoi4: kenhShopee?.videoPartnerKey ? String(kenhShopee.videoPartnerKey).slice(-4) : null,
                    pushVideo,
                    chuaMigrate,
                    conThieu: [
                        ...(daUyQuyenVideo ? [] : [
                            ...(kenhShopee?.videoPartnerId ? [] : [
                                'Nhập Partner ID + Live API Partner Key của app "Shopee Video Management" (app riêng trên console, KHÔNG phải app bán hàng) vào ô bên dưới.',
                            ]),
                            'Trong console Shopee, app Video phải khai Live Redirect URL Domain = kengi.vn — để trống là Shopee từ chối đường về.',
                            'Bấm "Uỷ quyền Shopee Video" và đăng nhập bằng tài khoản CHỦ shop: API video ký bằng user_id chứ không phải shop_id.',
                        ]),
                        /* Nhiều gian mà mới uỷ quyền MỘT (KENGISTORE 14/10/2026: Kengi Store xong, Tools + Electric
                         * chưa) — nói tên gian còn thiếu. Dòng "đường đăng đang được nối" cũ đã sai từ khi đăng chạy được. */
                        ...(daUyQuyenVideo && kenhShopeeDs.some((c: any) => !c.daUyQuyenVideo) ? [
                            `Gian ${kenhShopeeDs.filter((c: any) => !c.daUyQuyenVideo).map((c: any) => c.ten).join(', ')} chưa uỷ quyền Shopee Video — `
                            + 'bấm "Uỷ quyền" ở dòng gian đó và đăng nhập đúng tài khoản Shopee CHỦ của gian (mỗi gian một tài khoản thì làm riêng từng gian).',
                        ] : []),
                        'Mỗi tài khoản Shopee phải đồng ý Điều khoản Shopee Video trong Seller Center bản web.',
                    ],
                    duongApi: ['v2.media.init_video_upload', 'v2.media.upload_video_part', 'v2.media.complete_video_upload', 'v2.video.get_cover_list', 'v2.video.edit_video_info', 'v2.video.post_video'],
                    gioiHan: GIOI_HAN.shopee,
                },
                tiktok: {
                    dangDuoc: tt.daKetNoi && tt.coTaiLen,
                    daNoiKenhBanHang: coKenh('tiktok'),
                    ...tt,
                    conThieu: [
                        ...(tt.chuaMigrate ? ['Cửa hàng chưa có cột lưu kết nối TikTok — chạy POST /api/admin/migrate.'] : []),
                        ...(tt.coApp ? [] : ['Nhập Client key + Client secret của ứng dụng trên developers.tiktok.com (KHÔNG phải app TikTok Shop) vào ô bên dưới.']),
                        ...(tt.daKetNoi ? [] : ['Bấm "Kết nối TikTok" và đăng nhập bằng chính tài khoản TikTok sẽ đăng video.']),
                        ...(tt.daKetNoi && !tt.coTaiLen ? ['Tài khoản đã nối nhưng TikTok KHÔNG cấp quyền video.upload — kết nối lại và tick đủ quyền.'] : []),
                        ...(tt.daKetNoi && tt.coTaiLen && !tt.coDangThang
                            ? ['Đang ở chế độ HỘP THƯ: video vào mục thông báo của app TikTok, chủ tài khoản mở app bấm hoàn tất. Muốn đăng thẳng thì kết nối lại và bật "đăng thẳng" (quyền video.publish).']
                            : []),
                    ],
                    duongApi: [
                        'POST /v2/oauth/token/',
                        'POST /v2/post/publish/inbox/video/init/',
                        'POST /v2/post/publish/video/init/',
                        'PUT <upload_url> (Content-Range)',
                        'POST /v2/post/publish/status/fetch/',
                    ],
                    gioiHan: GIOI_HAN.tiktok,
                },
                tomTat: daUyQuyenVideo || (tt.daKetNoi && tt.coTaiLen)
                    ? 'Kho media dùng được. Sàn nào đã uỷ quyền thì bấm đăng thẳng từ đây.'
                    : 'Kho media dùng được ngay. Nút đăng thẳng lên sàn CHƯA bật vì mỗi sàn đòi một luồng uỷ quyền riêng, khác token bán hàng hiện có.',
            },
        })
    } catch (err: any) {
        console.error('GET /san-media/san-sang lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được tình trạng') })
    }
})

export default router
