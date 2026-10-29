/**
 * /api/meinvoice — kết nối MISA meInvoice + soi hoá đơn kế toán đã xuất (28/10/2026)
 * Chủ shop: gửi hoá đơn cho khách gõ /hoadon hoặc khách lấy định kỳ qua nhóm Zalo. Xem lib/meInvoice.ts, lib/hoaDonMisaZalo.ts.
 *
 *   GET    /ket-noi       kết nối đã lưu — KHÔNG trả bí mật                                   einvoice.view
 *   PUT    /ket-noi       lưu kết nối (Client Secret / mật khẩu để trống = giữ nguyên)         einvoice.config
 *   DELETE /ket-noi       xoá kết nối                                                         einvoice.config
 *   POST   /ket-noi/thu   thử đăng nhập cả hai đường (lấy token mới)                          einvoice.config
 *   POST   /soi           {tu, den?, trangThai?} CHỈ ĐỌC: hoá đơn trên web app meInvoice (thường + máy tính tiền) +
 *                         xem trước hoá đơn nào sẽ gửi nhóm Zalo nào (chưa gửi gì)              einvoice.view
 *   POST   /do-tho        {tu, den?, trangThai?, bienThe?} CHỈ ĐỌC: hình dữ liệu MISA trả về theo từng biến thể
 *                         (danh sách / có mã / khoảng ngày) — đo trước khi map                    einvoice.view
 *
 * Vận hành nội bộ (đo dữ liệu thật): x-admin-key + x-store-code CHỈ cho GET /ket-noi, POST /ket-noi/thu, POST /soi, POST /do-tho — không sửa/xoá.
 */

import { Router, Response, NextFunction } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { errMsg } from '../lib/errorResponse'
import {
    LoiMeInvoice, docKetNoi, moTaKetNoi, luuKetNoi, xoaKetNoi, thuKetNoi, dsHoaDonWeb, docHoaDon, doTho, TRANG_THAI_WEB, NGUON_WEB,
    type BienTheDo, type NguonWeb,
} from '../lib/meInvoice'
import { xemTruocGui, NHAN_KET_QUA } from '../lib/hoaDonMisaZalo'

const router = Router()

const QUA_KHOA_QUAN_TRI = new Set(['GET /ket-noi', 'POST /ket-noi/thu', 'POST /soi', 'POST /do-tho'])

router.use(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const adminKey = req.headers['x-admin-key'] as string
    if (!(adminKey && process.env.ADMIN_KEY && adminKey === process.env.ADMIN_KEY)) { next(); return }
    if (!QUA_KHOA_QUAN_TRI.has(`${req.method} ${req.path}`)) {
        res.status(403).json({ success: false, error: 'Khoá quản trị chỉ được xem / thử / soi meInvoice — sửa kết nối phải đăng nhập cửa hàng' })
        return
    }
    const code = String(req.headers['x-store-code'] || '').trim()
    const { registryPrisma, getStorePrisma } = await import('../lib/prisma')
    const store = code ? await registryPrisma.store.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } }) : null
    if (!store) { res.status(400).json({ success: false, error: 'x-admin-key cần kèm x-store-code hợp lệ' }); return }
    req.storePrisma = getStorePrisma(store.schema)
    req.user = { role: 'admin', userId: 'admin-key', email: 'admin-key', storeSchema: store.schema, branchSchema: store.schema } as any
    ;(req as any).__viaAdminKey = true
    next()
})
router.use((req: AuthRequest, res: Response, next: NextFunction) => ((req as any).__viaAdminKey ? next() : authMiddleware(req, res, next)))

const XEM = requirePermission('einvoice.view')
const CAU_HINH = requirePermission('einvoice.config')

/** Lỗi của MISA / lỗi nhập liệu hiện nguyên văn; lỗi nội bộ thì gọn */
function traLoi(res: Response, e: any) {
    // lỗi nhập liệu / MISA từ chối ⇒ 400; MISA sập (5xx) ⇒ 502
    if (e instanceof LoiMeInvoice) { res.status(e.httpStatus && e.httpStatus >= 500 ? 502 : 400).json({ success: false, error: e.message }); return }
    console.error('[meinvoice]', e?.message || e)
    res.status(500).json({ success: false, error: errMsg(e) })
}

router.get('/ket-noi', XEM, async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: moTaKetNoi(await docKetNoi(req.storePrisma)) })
    } catch (e: any) { traLoi(res, e) }
})

router.put('/ket-noi', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        await luuKetNoi(req.storePrisma, {
            dungChungAmis: typeof b.dungChungAmis === 'boolean' ? b.dungChungAmis : undefined,
            clientId: b.clientId, clientSecret: b.clientSecret, mst: b.mst, taiKhoan: b.taiKhoan, matKhau: b.matKhau,
            coMa: typeof b.coMa === 'boolean' ? b.coMa : undefined,
            congRieng: b.congRieng,
        }, String(req.user?.email || req.user?.userId || ''))
        res.json({ success: true, data: moTaKetNoi(await docKetNoi(req.storePrisma)) })
    } catch (e: any) { traLoi(res, e) }
})

router.delete('/ket-noi', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: { daXoa: await xoaKetNoi(req.storePrisma) } })
    } catch (e: any) { traLoi(res, e) }
})

router.post('/ket-noi/thu', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: await thuKetNoi(req.storePrisma) })
    } catch (e: any) { traLoi(res, e) }
})

const laNgay = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'))
const SOI_TOI_DA_NGAY = 7
const SOI_TOI_DA_DONG = 1000

router.post('/soi', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        const tu = String(b.tu || '')
        const den = b.den ? String(b.den) : tu
        const trangThai = b.trangThai === undefined ? '6' : String(b.trangThai)
        if (!laNgay(tu) || !laNgay(den) || den < tu) { res.status(400).json({ success: false, error: 'Ngày phải dạng YYYY-MM-DD, "đến" không trước "từ"' }); return }
        if ((Date.parse(den) - Date.parse(tu)) / 86_400_000 + 1 > SOI_TOI_DA_NGAY) { res.status(400).json({ success: false, error: `Soi tối đa ${SOI_TOI_DA_NGAY} ngày một lần` }); return }
        if (!TRANG_THAI_WEB[trangThai]) { res.status(400).json({ success: false, error: 'trangThai phải là 0, 4, 6 hoặc 7' }); return }

        const kn = await docKetNoi(req.storePrisma)
        if (!kn) { res.status(400).json({ success: false, error: 'Cửa hàng chưa nhập kết nối meInvoice' }); return }
        const web = await dsHoaDonWeb(req.storePrisma, kn, tu, den, trangThai)
        const tho = web.tho
        const hoaDons = tho.map(docHoaDon)
        // xemTruocGui giữ thứ tự ⇒ dòng i là hoá đơn i
        const { dong, dem } = await xemTruocGui(req.storePrisma, hoaDons, trangThai === '6')

        // Không để "0 hoá đơn" che chuyện đọc hỏng
        const canhBao: string[] = []
        for (const n of Object.keys(web.loiNguon) as NguonWeb[]) canhBao.push(`Không đọc được ${NGUON_WEB[n].nhan} ${web.loiNguon[n]}`)
        if (web.khongDocDuoc.length) {
            const k = web.khongDocDuoc
            canhBao.push(`MISA trả dữ liệu Kengi chưa đọc được ở ${k.length} lượt (${k.slice(0, 3).map(x => `${NGUON_WEB[x.nguon].nhan} ngày ${x.ngay}: ${x.hinh}`).join('; ')}) — những ngày đó KHÔNG có nghĩa là không có hoá đơn.`)
        }

        // Tên trường MISA trả về (đo tên thật — tài liệu không ghi đủ) + một bản ghi mẫu nguyên văn
        const truong = [...new Set(tho.flatMap(r => (r && typeof r === 'object' ? Object.keys(r) : [])))].sort()
        res.json({
            success: true,
            data: {
                tu, den, trangThai, nhanTrangThai: TRANG_THAI_WEB[trangThai],
                tong: tho.length, ngayCat: web.ngayCat,
                demNguon: web.demNguon, nhanNguon: { thuong: NGUON_WEB.thuong.nhan, mtt: NGUON_WEB.mtt.nhan },
                canhBao,
                coMaTraCuu: hoaDons.filter(h => h.maTraCuu).length,
                truong, mau: tho[0] ?? null,
                dem, nhanKetQua: NHAN_KET_QUA,
                catDong: dong.length > SOI_TOI_DA_DONG,
                dong: dong.slice(0, SOI_TOI_DA_DONG).map((d, i) => ({
                    nguon: web.dong[i]?.nguon ?? null,
                    refId: d.hoaDon.refId, kyHieu: d.hoaDon.kyHieu, so: d.hoaDon.so, ngay: d.hoaDon.ngay,
                    nguoiMua: d.hoaDon.tenNguoiMua, mst: d.hoaDon.mst, maKhach: d.hoaDon.maKhach, tongTien: d.hoaDon.tongTien,
                    coMaTraCuu: !!d.hoaDon.maTraCuu, trangThaiMisa: d.hoaDon.trangThai,
                    ketQua: d.ketQua, lyDo: d.lyDo,
                    khach: d.khach ? { id: d.khach.id, code: d.khach.code, name: d.khach.name, luonLayHoaDon: d.khach.luonLayHoaDon } : null,
                    nhom: d.nhom.map(n => n.tenNhom || n.groupId),
                    phieu: d.phieu.slice(0, 5).map(p => ({ receiptNumber: p.receiptNumber, ngay: p.ngay, total: p.total, trungTien: p.trungTien })),
                })),
            },
        })
    } catch (e: any) { traLoi(res, e) }
})

const DO_TOI_DA_NGAY = 92
const soNgay = (tu: string, den: string) => (Date.parse(den) - Date.parse(tu)) / 86_400_000 + 1

router.post('/do-tho', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        const tu = String(b.tu || '')
        const den = b.den ? String(b.den) : tu
        const trangThai = b.trangThai === undefined ? '6' : String(b.trangThai)
        const sai = (t: any, d: any) => !laNgay(t) || !laNgay(d) || d < t || soNgay(t, d) > DO_TOI_DA_NGAY
        if (sai(tu, den)) { res.status(400).json({ success: false, error: `Ngày dạng YYYY-MM-DD, "đến" không trước "từ", tối đa ${DO_TOI_DA_NGAY} ngày` }); return }
        if (!TRANG_THAI_WEB[trangThai]) { res.status(400).json({ success: false, error: 'trangThai phải là 0, 4, 6 hoặc 7' }); return }

        // mặc định: cả khoảng MỘT lần, 3 bản ghi — thường có mã / thường không mã / máy tính tiền
        const goc = { trangThai, tu, den, start: 0, length: 3 }
        let bienThe: BienTheDo[] = [
            { nguon: 'thuong', coMa: true, ...goc },
            { nguon: 'thuong', coMa: false, ...goc },
            { nguon: 'mtt', coMa: true, ...goc },
        ]
        if (Array.isArray(b.bienThe) && b.bienThe.length) {
            if (b.bienThe.length > 8) { res.status(400).json({ success: false, error: 'Tối đa 8 biến thể một lần' }); return }
            bienThe = b.bienThe.map((x: any) => ({
                nguon: x?.nguon === 'mtt' ? 'mtt' : 'thuong',
                coMa: x?.coMa !== false,
                trangThai: TRANG_THAI_WEB[String(x?.trangThai)] ? String(x.trangThai) : trangThai,
                tu: laNgay(x?.tu) ? x.tu : tu,
                den: laNgay(x?.den) ? x.den : den,
                start: Math.max(0, Math.floor(Number(x?.start) || 0)),
                length: Math.min(100, Math.max(1, Math.floor(Number(x?.length) || 3))),
            }))
            if (bienThe.some(x => sai(x.tu, x.den))) { res.status(400).json({ success: false, error: `Khoảng ngày của biến thể sai hoặc quá ${DO_TOI_DA_NGAY} ngày` }); return }
        }

        const kn = await docKetNoi(req.storePrisma)
        if (!kn) { res.status(400).json({ success: false, error: 'Cửa hàng chưa nhập kết nối meInvoice' }); return }
        res.json({ success: true, data: { coMaDaLuu: kn.coMa, ketQua: await doTho(req.storePrisma, kn, bienThe) } })
    } catch (e: any) { traLoi(res, e) }
})

export default router
