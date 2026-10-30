/**
 * DUYỆT TIN CHAT AI TRÊN APP (30/10/2026) — /api/online-orders/chat/cho-duyet · lõi lib/choDuyetChat.ts.
 *
 * Chủ shop: "chỉnh bên file apk để t duyệt". AI soạn nháp cho gian Shopee ở chế độ chờ duyệt (lib/tuTraLoiShopee.ts), người đọc rồi
 * bấm Gửi trên app ⇒ send_message như nhân viên gõ ở trang chat web, Shopee tính vào Tỷ lệ phản hồi Chat.
 *
 *  GET  /               — nháp đang chờ (khẩn nhất lên đầu) + tin khách mới nhất ĐỌC SỐNG từ Shopee (không lưu) + các gian Shopee
 *  POST /:id/gui        — { noiDung } người bấm Gửi (câu có thể đã sửa)
 *  POST /:id/bo         — bỏ nháp (đã trả lời ở chỗ khác / không cần trả lời)
 *  PUT  /gian/:kenhId   — { bat?, cheDo? } bật tắt / đổi chế độ một gian Shopee — CHỈ quản lý
 *
 * x-admin-key + x-store-code chỉ được ĐỌC (soát vận hành). Gửi / bỏ / đổi chế độ phải là người đăng nhập — tin tới khách phải có
 * người bấm. Mount TRƯỚC router đơn online và router chat (index.ts).
 */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { moTaLoi } from '../lib/gomLoi'
import { khoChoDuyetSql, guiNhapDaDuyet, daCoNguoiTraLoiSau, phutConLai, BanNhap } from '../lib/choDuyetChat'
import { khoTuTraLoiSql, tinhTrangTuTraLoi, datTuTraLoi, datCheDoTuTraLoi, CheDoTuTraLoi, TrangThaiNhatKy } from '../lib/tuTraLoiShopee'
import { chuTinShopee, laTinCuaGian, ShopeeService, TinShopeeGoiY } from '../services/platforms/shopee'
import { getShopeeServiceForChannel, withTokenRefresh } from './chat'

const router = Router()
const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin']

// Soát vận hành: x-admin-key + x-store-code — CHỈ GET (giống routes/chat.ts)
router.use(async (req: any, res: Response, next: any) => {
    const adminKey = req.headers['x-admin-key'] as string
    if (!adminKey || !process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) { next(); return }
    if (req.method !== 'GET') { res.status(403).json({ success: false, error: 'x-admin-key chỉ được đọc — gửi / bỏ tin phải là người đăng nhập' }); return }
    const code = String(req.headers['x-store-code'] || '').trim()
    if (code) {
        const { registryPrisma, getStorePrisma } = await import('../lib/prisma')
        const store = await registryPrisma.store.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } })
        if (store) {
            req.storePrisma = getStorePrisma(store.schema)
            req.user = { role: 'admin', storeSchema: store.schema, branchSchema: store.schema }
            req.__viaAdminKey = true
            next()
            return
        }
    }
    res.status(400).json({ success: false, error: 'x-admin-key cần kèm x-store-code hợp lệ' })
})
const xacThuc = (req: any, res: Response, next: any) => req.__viaAdminKey ? next() : authMiddleware(req, res, next)
const quyenChat = (req: any, res: Response, next: any) => req.__viaAdminKey ? next() : requirePermission('online_chat')(req, res, next)

const tenNguoi = (req: AuthRequest) => String(req.user?.email || req.user?.userId || '') || null

/** Giây / mili giây / nano giây của Shopee ⇒ ISO */
function lucTin(ts: unknown): { iso: string | null; ms: number | null } {
    const t = Number(ts)
    if (!Number.isFinite(t) || t <= 0) return { iso: null, ms: null }
    const ms = t > 1e17 ? t / 1e6 : t > 1e14 ? t / 1e3 : t > 1e11 ? t : t * 1000
    return { iso: new Date(ms).toISOString(), ms }
}

/** Chạy fn cho từng phần tử, tối đa `luong` việc cùng lúc (đọc Shopee từng hội thoại) */
async function chayGioiHan<T>(ds: T[], luong: number, fn: (x: T) => Promise<void>): Promise<void> {
    let i = 0
    const tho = async () => { while (i < ds.length) { const x = ds[i++]!; await fn(x) } }
    await Promise.all(Array.from({ length: Math.min(luong, ds.length) }, tho))
}

router.get('/', xacThuc, quyenChat, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const viaAdminKey = !!(req as any).__viaAdminKey
        const kho = khoChoDuyetSql(prisma)
        const kenh: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id", "name" FROM "OnlineChannel" WHERE "platform" = 'shopee' AND COALESCE("status", 'active') <> 'inactive' ORDER BY "name"`)
        const tenGian = new Map(kenh.map(k => [String(k.id), String(k.name || '')]))
        const ds = await kho.danhSach(30)

        const dichVu = new Map<string, Promise<{ shopee: ShopeeService; channel: any }>>()
        const layDichVu = (kenhId: string) => {
            if (!dichVu.has(kenhId)) dichVu.set(kenhId, getShopeeServiceForChannel(prisma, kenhId))
            return dichVu.get(kenhId)!
        }
        const bayGio = Date.now()
        const items: any[] = []
        await chayGioiHan(ds, 3, async (n: BanNhap) => {
            let tinKhach: { id: string; noiDung: string; luc: string | null }[] = []
            let docTinLoi: string | null = null
            let tinDauMs: number | null = null
            try {
                const { shopee, channel } = await layDichVu(n.kenhId)
                const r = await withTokenRefresh(prisma, channel, shopee, () => shopee.getMessages(n.hoiThoaiId, { pageSize: 15 }))
                const dsTin: TinShopeeGoiY[] = (r.messages as TinShopeeGoiY[]).slice().reverse() // Shopee trả mới → cũ
                if (daCoNguoiTraLoiSau(dsTin, n.tinKhachId, channel.shopId)) {
                    // Đã có người của gian trả lời ở Seller Centre / web — nháp thừa, cất khỏi hàng chờ (đường soát thì chỉ ẩn)
                    if (!viaAdminKey) await kho.bo(n.id, null, 'người của gian đã trả lời ở chỗ khác').catch(() => { })
                    return
                }
                let cuoiGian = -1
                dsTin.forEach((m, i) => { if (laTinCuaGian(m, channel.shopId) && m.source !== 'server') cuoiGian = i })
                const cho = dsTin.slice(cuoiGian + 1).filter(m => !laTinCuaGian(m, channel.shopId))
                tinDauMs = lucTin((cho[0] as any)?.createdTimestamp).ms
                tinKhach = cho.slice(-5).map(m => ({
                    id: String(m.messageId),
                    noiDung: chuTinShopee(m, new Map()).trim().slice(0, 500),
                    luc: lucTin((m as any).createdTimestamp).iso,
                }))
            } catch (e) {
                docTinLoi = 'Không đọc được tin từ Shopee lúc này'
                console.warn(`[chat cho-duyet] đọc hội thoại lỗi: ${moTaLoi(e).slice(0, 160)}`)
            }
            items.push({
                id: n.id,
                kenhId: n.kenhId,
                tenGian: tenGian.get(n.kenhId) || '',
                hoiThoaiId: n.hoiThoaiId,
                tenKhach: n.tenKhach,
                traLoi: n.traLoi,
                canNhanVien: n.canNhanVien,
                ghiChu: n.ghiChu,
                loiLanTruoc: n.loi,
                taoLuc: n.taoLuc,
                conLaiPhut: phutConLai(tinDauMs, Date.parse(n.taoLuc), bayGio),
                tinKhach,
                docTinLoi,
            })
        })
        items.sort((a, b) => a.conLaiPhut - b.conLaiPhut)

        const tt = await tinhTrangTuTraLoi(prisma, kenh.map(k => String(k.id)))
        const gian = tt.map(x => ({
            kenhId: x.kenhId, ten: tenGian.get(x.kenhId) || '', bat: x.bat, cheDo: x.cheDo, choDuyet: x.choDuyet, tatLyDo: x.tatLyDo,
        }))
        const vaiTro = String(req.user?.role || '').toLowerCase()
        res.json({ success: true, data: { items, gian, coQuyenCaiDat: viaAdminKey || QUAN_LY.includes(vaiTro) } })
    } catch (err: any) {
        console.error('[chat cho-duyet GET]', moTaLoi(err))
        res.status(500).json({ success: false, error: 'Không đọc được danh sách tin chờ duyệt' })
    }
})

router.post('/:id/gui', xacThuc, quyenChat, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = String(req.params.id || '')
        const nguoi = tenNguoi(req)
        const nhatKy = khoTuTraLoiSql(prisma)
        let dv: { shopee: ShopeeService; channel: any } | null = null
        const layDv = async (kenhId: string) => (dv ||= await getShopeeServiceForChannel(prisma, kenhId))
        const kq = await guiNhapDaDuyet({
            kho: khoChoDuyetSql(prisma),
            async docTin(n) {
                const d = await layDv(n.kenhId)
                const r = await withTokenRefresh(prisma, d.channel, d.shopee, () => d.shopee.getMessages(n.hoiThoaiId, { pageSize: 15 }))
                return { ds: (r.messages as TinShopeeGoiY[]).slice().reverse(), shopId: String(d.channel.shopId || '') }
            },
            async gui(n, cau) {
                const d = await layDv(n.kenhId)
                const r = await withTokenRefresh(prisma, d.channel, d.shopee, () => d.shopee.sendMessage(Number(n.nguoiMuaId), cau))
                return { messageId: String(r?.messageId || '') }
            },
            ghiNhatKy: (n, t, lyDo) => nhatKy.ghiKetQua(n.kenhId, n.hoiThoaiId, n.tinKhachId, t as TrangThaiNhatKy, lyDo),
        }, id, req.body?.noiDung, nguoi)
        if (kq.ok) {
            console.log(`[chat cho-duyet] ${nguoi || '?'} duyệt và gửi nháp ${id}`)
            res.json({ success: true, data: { id, trangThai: 'da_gui', maTinGui: kq.maTinGui } })
            return
        }
        const status = kq.ma === 'noi_dung' ? 400 : (kq.ma === 'khong_con' || kq.ma === 'da_co_nguoi_tra_loi') ? 409 : 502
        res.status(status).json({ success: false, error: kq.loi, ma: kq.ma })
    } catch (err: any) {
        console.error('[chat cho-duyet gui]', moTaLoi(err))
        res.status(500).json({ success: false, error: 'Không gửi được tin — thử lại' })
    }
})

router.post('/:id/bo', xacThuc, quyenChat, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const kho = khoChoDuyetSql(prisma)
        const id = String(req.params.id || '')
        const n = await kho.doc(id)
        const nguoi = tenNguoi(req)
        if (!n || !(await kho.bo(id, nguoi, 'người duyệt bỏ qua'))) {
            res.status(409).json({ success: false, error: 'Tin này đã được xử lý rồi', ma: 'khong_con' })
            return
        }
        await khoTuTraLoiSql(prisma).ghiKetQua(n.kenhId, n.hoiThoaiId, n.tinKhachId, 'bo_qua', `người duyệt bỏ qua: ${nguoi || '?'}`).catch(() => { })
        res.json({ success: true, data: { id, trangThai: 'bo' } })
    } catch (err: any) {
        console.error('[chat cho-duyet bo]', moTaLoi(err))
        res.status(500).json({ success: false, error: 'Không bỏ được tin này — thử lại' })
    }
})

router.put('/gian/:kenhId', xacThuc, quyenChat, async (req: AuthRequest, res: Response) => {
    try {
        const vaiTro = String(req.user?.role || '').toLowerCase()
        if (!QUAN_LY.includes(vaiTro)) {
            res.status(403).json({ success: false, error: 'Chỉ admin / quản lý mới đổi được cài đặt tự trả lời' })
            return
        }
        // App Android ghi null TƯỜNG MINH cho trường bỏ trống (kotlinx explicitNulls) ⇒ null = không đổi, như vắng
        const bat = req.body?.bat ?? undefined
        const cheDo = req.body?.cheDo ?? undefined
        if (bat !== undefined && typeof bat !== 'boolean') { res.status(400).json({ success: false, error: 'bat phải là true / false' }); return }
        if (cheDo !== undefined && cheDo !== 'cho_duyet' && cheDo !== 'tu_gui') { res.status(400).json({ success: false, error: 'cheDo phải là cho_duyet / tu_gui' }); return }
        if (bat === undefined && cheDo === undefined) { res.status(400).json({ success: false, error: 'Thiếu bat / cheDo' }); return }
        const prisma = req.storePrisma!
        const kenh: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "OnlineChannel" WHERE "id" = $1 AND "platform" = 'shopee' LIMIT 1`, String(req.params.kenhId))
        if (!kenh.length) { res.status(404).json({ success: false, error: 'Không có gian Shopee này' }); return }
        const kenhId = String(kenh[0].id)
        const nguoi = tenNguoi(req)
        if (cheDo !== undefined) await datCheDoTuTraLoi(prisma, kenhId, cheDo as CheDoTuTraLoi, nguoi)
        if (bat !== undefined) await datTuTraLoi(prisma, kenhId, bat, nguoi)
        console.log(`[chat cho-duyet] ${nguoi || '?'} đặt gian ${kenhId}: ${bat !== undefined ? (bat ? 'BẬT' : 'tắt') : ''} ${cheDo || ''}`.trim())
        const [tt] = await tinhTrangTuTraLoi(prisma, [kenhId])
        res.json({ success: true, data: { kenhId, bat: !!tt?.bat, cheDo: tt?.cheDo || 'cho_duyet' } })
    } catch (err: any) {
        console.error('[chat cho-duyet gian]', moTaLoi(err))
        res.status(500).json({ success: false, error: 'Không lưu được cài đặt' })
    }
})

export default router
