/* ═══════════════════════════════════════════════════════════════════════════════
 *  MEDIA BÁN HÀNG › TỰ ĐỘNG (14/10/2026) — gắn ở /api/san-media TRƯỚC router chính (đường riêng, không đụng /:id)
 *
 *  Chủ shop: "Tự động tới giờ sẽ tạo video, tự hẹn giờ cho hợp lý các video cũ sao cho không trùng và nội dung
 *  các video không được trùng nhau trên 1 mã hàng".
 *    GET  /tu-dong              cấu hình + chỉ tiêu hôm nay + máy dựng + nhật ký
 *    PUT  /tu-dong              lưu {bat, cauHinh}
 *    POST /tu-dong/nhan-viec    máy dựng (tab kengi.vn được chỉ định) xin việc — lib/videoTuDong.ts
 *    POST /tu-dong/xong-viec    báo xong / hỏng một việc (xong thì tự xếp lịch đăng nếu bật)
 *    POST /tu-dong/tra-cho      máy dựng thôi làm (đóng tab, tắt máy dựng)
 *    GET  /thong-ke             đếm theo trạng thái, tạo hôm nay, lịch sắp tới theo ngày, từng gian
 *    GET  /kiem-van-tay         cùng SKU đã có video cùng vân tay nội dung chưa (kiểm trước khi tải lên Drive)
 *    POST /xep-lich             TỰ XẾP LỊCH video Nháp — mặc định chạy thử, {apDung:true} mới hẹn thật
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { chuanTuDong, chiTieuHomNay, docTuDong, luuTuDong, nhanViec, traCho, xongViec, type MayDung } from '../lib/videoTuDong'
import { apDungLich, chuanXep, lapLich, mocVN, ngayVN } from '../lib/xepLichVideo'

const router = Router()
const XEM = requirePermission('online_orders.view')
const SUA = requirePermission('online_orders.edit', 'online_orders.view')

/* Bảng mới (14/10/2026) — cửa hàng chưa chạy /admin/migrate thì nói đúng bệnh, không trả rỗng như thể chưa cấu hình */
const laThieuBang = (e: any) => /P2021|P2022|does not exist|relation .* does not exist/i.test(String(e?.code || '') + ' ' + String(e?.message || ''))
function traLoi(res: Response, e: any, noi: string) {
    if (laThieuBang(e)) { res.status(503).json({ success: false, error: 'Cửa hàng chưa có bảng/cột Media tự động — chạy POST /api/admin/migrate rồi thử lại.' }); return }
    console.error(`${noi} lỗi:`, e?.message || e)
    res.status(500).json({ success: false, error: String(e?.message || e).slice(0, 400) })
}

function docMay(b: any): MayDung | null {
    const m = b?.may
    const id = String(m?.id || '')
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null
    return {
        id, ten: String(m?.ten || 'Máy dựng').slice(0, 80), luc: new Date().toISOString(),
        coGiong: m?.coGiong === true, phienBan: Number(m?.phienBan) || undefined, trangThai: String(m?.trangThai || '').slice(0, 40) || undefined,
    }
}

async function trangThai(prisma: any) {
    const td = await docTuDong(prisma)
    const homNay = await chiTieuHomNay(prisma, td.cauHinh, td.nhatKy, Date.now(), true)
    return {
        bat: td.bat, cauHinh: td.cauHinh, homNay, mayDung: td.mayDung,
        giuCho: td.giuChoBoi && td.giuChoDen && Date.parse(td.giuChoDen) > Date.now() ? { boi: td.giuChoBoi, den: td.giuChoDen } : null,
        nhatKy: td.nhatKy.slice(-30).reverse(),
    }
}

router.get('/tu-dong', authMiddleware, XEM, async (req: AuthRequest, res: Response) => {
    try { res.json({ success: true, data: await trangThai(req.storePrisma!) }) } catch (e) { traLoi(res, e, 'GET /san-media/tu-dong') }
})

router.put('/tu-dong', authMiddleware, SUA, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const hienTai = await docTuDong(prisma)
        const bat = typeof req.body?.bat === 'boolean' ? req.body.bat : hienTai.bat
        const cauHinh = chuanTuDong({ ...hienTai.cauHinh, ...(req.body?.cauHinh || {}) })
        if (bat && cauHinh.henGio && cauHinh.khaiAI == null) {
            res.status(400).json({ success: false, error: 'Tự hẹn giờ đăng Shopee cần khai video có dùng AI hay không — chọn "Có AI" hoặc "Không AI".' })
            return
        }
        await luuTuDong(prisma, bat, cauHinh)
        res.json({ success: true, data: await trangThai(prisma) })
    } catch (e) { traLoi(res, e, 'PUT /san-media/tu-dong') }
})

router.post('/tu-dong/nhan-viec', authMiddleware, SUA, async (req: AuthRequest, res: Response) => {
    try {
        const may = docMay(req.body)
        if (!may) { res.status(400).json({ success: false, error: 'Thiếu mã máy dựng' }); return }
        res.json({ success: true, data: await nhanViec(req.storePrisma!, may) })
    } catch (e) { traLoi(res, e, 'POST /san-media/tu-dong/nhan-viec') }
})

router.post('/tu-dong/xong-viec', authMiddleware, SUA, async (req: AuthRequest, res: Response) => {
    try {
        const may = docMay(req.body)
        if (!may) { res.status(400).json({ success: false, error: 'Thiếu mã máy dựng' }); return }
        const b = req.body || {}
        const kq = await xongViec(req.storePrisma!, may, {
            loai: String(b.loai || ''), channelId: b.channelId ? String(b.channelId) : undefined, tenGian: b.tenGian ? String(b.tenGian).slice(0, 80) : undefined,
            sku: b.sku ? String(b.sku).slice(0, 80) : undefined, mediaId: b.mediaId ? String(b.mediaId) : undefined,
            thongDiep: b.thongDiep ? String(b.thongDiep) : undefined,
        })
        res.json({ success: true, data: kq })
    } catch (e) { traLoi(res, e, 'POST /san-media/tu-dong/xong-viec') }
})

router.post('/tu-dong/tra-cho', authMiddleware, SUA, async (req: AuthRequest, res: Response) => {
    try {
        const may = docMay(req.body)
        if (may) await traCho(req.storePrisma!, may.id)
        res.json({ success: true })
    } catch (e) { traLoi(res, e, 'POST /san-media/tu-dong/tra-cho') }
})

/** THỐNG KÊ kho Media (14/10/2026, chủ shop: "hiện thống kê đã tạo bao nhiêu video, đã lên lịch bao nhiêu"): đếm theo
 *  trạng thái, tạo hôm nay (tay / tự động), lịch sắp tới theo ngày, từng gian. POOL 1 ⇒ tuần tự. Đọc hỏng ⇒ 500, không
 *  trả số 0 (0 là "chưa có video nào", khác hẳn "không đọc được"). */
router.get('/thong-ke', authMiddleware, XEM, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const now = Date.now()
        const ngay = ngayVN(now)
        const dauNgay = new Date(mocVN(ngay, '00:00'))
        const tt: any[] = await prisma.sanMedia.groupBy({ by: ['trangThai'], _count: { _all: true } })
        const theoTrangThai: Record<string, number> = Object.fromEntries(tt.map(x => [x.trangThai, x._count?._all || 0]))
        const tong = Object.values(theoTrangThai).reduce((a, b) => a + b, 0)
        const taoHomNay = await prisma.sanMedia.count({ where: { createdAt: { gte: dauNgay } } })
        const tuDongHomNay = await prisma.sanMedia.count({ where: { tuDong: ngay } })
        const tuDongTong = await prisma.sanMedia.count({ where: { tuDong: { not: null } } })
        const daDangHomNay = await prisma.sanMedia.count({ where: { trangThai: 'da_dang', dangLuc: { gte: dauNgay } } })
        // Lịch SẮP TỚI: Kengi giữ (hen_gio) + Shopee giữ (da_len_lich), giờ hẹn từ bây giờ
        const lich: any[] = await prisma.sanMedia.findMany({
            where: { trangThai: { in: ['hen_gio', 'da_len_lich'] }, henDangLuc: { gte: new Date(now) } },
            select: { henDangLuc: true, channelId: true, trangThai: true }, orderBy: { henDangLuc: 'asc' }, take: 2000,
        })
        const theoNgay = new Map<string, number>()
        for (const l of lich) { const k = ngayVN(new Date(l.henDangLuc).getTime()); theoNgay.set(k, (theoNgay.get(k) || 0) + 1) }
        const gian: any[] = await prisma.sanMedia.groupBy({ by: ['channelId', 'trangThai'], where: { channelId: { not: null } }, _count: { _all: true } })
        const ten: any[] = gian.length ? await prisma.onlineChannel.findMany({ where: { id: { in: Array.from(new Set(gian.map(g => g.channelId))) } }, select: { id: true, name: true } }) : []
        const tenGian = new Map<string, string>(ten.map(c => [c.id, c.name]))
        const lichGian = new Map<string, number>()
        for (const l of lich) if (l.channelId) lichGian.set(l.channelId, (lichGian.get(l.channelId) || 0) + 1)
        const theoGian = Array.from(new Set(gian.map(g => g.channelId as string))).map(id => {
            const so = (t: string) => gian.filter(g => g.channelId === id && g.trangThai === t).reduce((a, g) => a + (g._count?._all || 0), 0)
            return { channelId: id, ten: tenGian.get(id) || '?', nhap: so('nhap'), lichSapToi: lichGian.get(id) || 0, daDang: so('da_dang'), loi: so('loi') }
        }).sort((a, b) => a.ten.localeCompare(b.ten))
        res.json({
            success: true,
            data: {
                tong, theoTrangThai, tuDongTong,
                homNay: { ngay, tao: taoHomNay, tuDong: tuDongHomNay, daDang: daDangHomNay },
                lich: {
                    tong: lich.length, kengiGiu: lich.filter(l => l.trangThai === 'hen_gio').length, shopeeGiu: lich.filter(l => l.trangThai === 'da_len_lich').length,
                    ganNhat: lich[0]?.henDangLuc ? new Date(lich[0].henDangLuc).toISOString() : null,
                    theoNgay: Array.from(theoNgay.entries()).slice(0, 10).map(([n, so]) => ({ ngay: n, so })),
                },
                theoGian,
            },
        })
    } catch (e) { traLoi(res, e, 'GET /san-media/thong-ke') }
})

/** Kiểm vân tay TRƯỚC khi tải video lên Drive: trùng thì POST /san-media sẽ từ chối, file đã lên Drive thành mồ côi. */
router.get('/kiem-van-tay', authMiddleware, XEM, async (req: AuthRequest, res: Response) => {
    try {
        const vanTay = String(req.query.vanTay || '')
        const skus = String(req.query.skus || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 50)
        if (!/^[0-9a-f]{16}$/.test(vanTay) || !skus.length) { res.json({ success: true, data: { trung: null } }); return }
        const trung = await (req.storePrisma as any).sanMedia.findFirst({
            where: { vanTay, sanPham: { some: { sku: { in: skus } } } }, select: { id: true, ten: true, createdAt: true },
        })
        res.json({ success: true, data: { trung: trung || null } })
    } catch (e) { traLoi(res, e, 'GET /san-media/kiem-van-tay') }
})

/** Tự xếp lịch: {ids?, xep?, apDung?: boolean, luu?: boolean}. Không có xep ⇒ dùng khung đã lưu ở cấu hình tự động. */
router.post('/xep-lich', authMiddleware, SUA, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const b = req.body || {}
        const td = await docTuDong(prisma)
        const xep = chuanXep(b.xep ? { ...td.cauHinh.xepLich, ...b.xep } : td.cauHinh.xepLich)
        if (b.luu === true) await luuTuDong(prisma, td.bat, { ...td.cauHinh, xepLich: xep })
        const kh = await lapLich(prisma, { ids: Array.isArray(b.ids) ? b.ids : undefined, xep })
        if (b.apDung !== true) { res.json({ success: true, data: { ...kh, daApDung: false } }); return }
        const ketQua = await apDungLich(prisma, kh.ke)
        res.json({ success: true, data: { ...kh, daApDung: true, ketQua } })
    } catch (e) { traLoi(res, e, 'POST /san-media/xep-lich') }
})

export default router
