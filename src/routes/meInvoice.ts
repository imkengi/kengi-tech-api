/**
 * /api/meinvoice — kết nối MISA meInvoice + soi hoá đơn kế toán đã xuất (28/10/2026)
 * Chủ shop: gửi hoá đơn cho khách gõ /hoadon hoặc khách lấy định kỳ qua nhóm Zalo. Xem lib/meInvoice.ts, lib/hoaDonMisaZalo.ts.
 *
 *   GET    /ket-noi       kết nối đã lưu — KHÔNG trả bí mật                                   einvoice.view
 *   PUT    /ket-noi       lưu kết nối (Client Secret / mật khẩu để trống = giữ nguyên)         einvoice.config
 *   DELETE /ket-noi       xoá kết nối                                                         einvoice.config
 *   POST   /ket-noi/thu   thử đăng nhập cả hai đường (lấy token mới)                          einvoice.config
 *   POST   /soi           {tu, den?} CHỈ ĐỌC: hoá đơn ĐÃ PHÁT HÀNH (danh sách tích hợp /invoice/paging — mọi kênh lập) +
 *                         xem trước hoá đơn nào sẽ gửi nhóm Zalo nào (chưa gửi gì)              einvoice.view
 *   POST   /do-tho        {tu, den?, trangThai?, bienThe?, maTraCuu?, taiPdf?, xemLink?} CHỈ ĐỌC: hình dữ liệu MISA trả về theo
 *                         từng biến thể + trạng thái theo mã tra cứu + tải thử PDF / link xem (không trả tệp, không trả link)  einvoice.view
 * Gửi hoá đơn qua nhóm Zalo (29/10/2026, lib/guiHoaDonMisa.ts):
 *   GET    /gui/cai-dat   tự động gửi + mẫu tin + kênh Zalo                                    einvoice.view
 *   PUT    /gui/cai-dat   {tuDong?, mauTin?}                                                   einvoice.config
 *   POST   /gui           {maTraCuu, ngay} GỬI TAY một hoá đơn (đọc lại từ MISA, đủ 4 cửa)      einvoice.config
 *   GET    /gui/gan-day   sổ hoá đơn đã xếp / lỗi / bỏ gần đây                                  einvoice.view
 *   GET    /hd/:ma/:token CÔNG KHAI — link trong tin Zalo: tải PDF có chữ ký số từ MISA (token ngẫu nhiên 144 bit)
 *
 * Vận hành nội bộ (đo dữ liệu thật): x-admin-key + x-store-code CHỈ cho các đường CHỈ ĐỌC trong QUA_KHOA_QUAN_TRI — không sửa,
 * không xoá, KHÔNG GỬI (gửi tin cho khách là việc chủ shop bấm).
 */

import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { errMsg } from '../lib/errorResponse'
import {
    LoiMeInvoice, docKetNoi, moTaKetNoi, luuKetNoi, xoaKetNoi, thuKetNoi, dsHoaDonPhatHanh, docHoaDon, doTho, doTrangThai, goiApiTho, moTaHinh,
    TRANG_THAI_WEB, NGUON_WEB, type BienTheDo,
} from '../lib/meInvoice'
import { xemTruocGui, NHAN_KET_QUA } from '../lib/hoaDonMisaZalo'
import {
    docCaiDat, luuCaiDat, guiTay, dsGanDay, trangThaiGuiNhieu, moTheoToken, moTaKenhZalo, docPdf, docLinkXem, MAU_MAC_DINH, BIEN_HOA_DON, TOKEN_RE,
    LAN_TU_DONG_TOI_DA, TRANG_TRA_CUU_MISA,
} from '../lib/guiHoaDonMisa'

const router = Router()

// ─── CÔNG KHAI: link hoá đơn trong tin Zalo — khai báo TRƯỚC lớp đăng nhập ─────
const PDF_NHO_MS = 15 * 60_000
/** Tối đa bấy nhiêu PDF trong RAM (~0,5 MB/tệp, đo 29/10/2026) — chủ shop 29/10: hạ 40 → 10 cho máy chủ 512 MB (từng tràn bộ nhớ) */
const PDF_NHO_TOI_DA = 10
const pdfNho = new Map<string, { buf: Buffer; ten: string; het: number }>()

router.get('/hd/:ma/:token', async (req: Request, res: Response) => {
    const ma = String(req.params.ma || '')
    const token = String(req.params.token || '')
    const trang = (code: number, chu: string) => res.status(code).type('html').send(
        `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hoá đơn</title></head>`
        + `<body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.6;color:#1f2937"><p>${chu}</p></body></html>`)
    const guiPdf = (buf: Buffer, ten: string) => {
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="${ten}"`)
        res.setHeader('Cache-Control', 'private, max-age=300')
        res.send(buf)
    }
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(ma) || !TOKEN_RE.test(token)) { trang(404, 'Link hoá đơn không đúng.'); return }
    const khoa = `${ma.toLowerCase()}/${token}`
    const nho = pdfNho.get(khoa)
    if (nho && nho.het > Date.now()) { guiPdf(nho.buf, nho.ten); return }
    try {
        const { registryPrisma, getStorePrisma } = await import('../lib/prisma')
        const store: any = await (registryPrisma as any).store.findFirst({ where: { code: { equals: ma, mode: 'insensitive' } }, select: { schema: true } })
        const kq = store ? await moTheoToken(getStorePrisma(store.schema), token) : null
        if (!kq) { trang(404, 'Link hoá đơn không đúng hoặc đã bị gỡ.'); return }
        // Mẫu hoá đơn MISA không cho tải PDF (TemplateNotSupport, đo 29/10/2026) ⇒ sang trang xem chính thức của MISA (link có hạn, lấy mới mỗi lần)
        if (kq.loai === 'xem') { res.setHeader('Cache-Control', 'no-store'); res.redirect(302, kq.link); return }
        if (kq.loai === 'loi') {
            const maTc = kq.maTraCuu.replace(/[^0-9A-Za-z_-]/g, '')
            trang(503, `Chưa mở được bản hoá đơn${kq.so ? ` số ${String(kq.so).replace(/[^0-9A-Za-z]/g, '')}` : ''} lúc này. Quý khách có thể tra cứu hoá đơn gốc tại `
                + `<a href="${TRANG_TRA_CUU_MISA}">meinvoice.vn/tra-cuu</a> với mã tra cứu: <b style="font-family:monospace">${maTc}</b>, hoặc thử lại link sau ít phút.`)
            return
        }
        // nhớ ít phút: khách bấm lại / Zalo mở thử link thì khỏi gọi MISA lần nữa
        pdfNho.set(khoa, { buf: kq.buf, ten: kq.ten, het: Date.now() + PDF_NHO_MS })
        // bỏ tệp hết hạn + tệp cũ nhất khi quá trần (Map giữ thứ tự thêm vào)
        for (const [k, v] of pdfNho) if (v.het < Date.now() || pdfNho.size > PDF_NHO_TOI_DA) pdfNho.delete(k)
        guiPdf(kq.buf, kq.ten)
    } catch (e: any) {
        console.error('[meinvoice/hd]', e?.message || e)
        trang(503, 'Chưa tải được hoá đơn lúc này — vui lòng thử lại sau ít phút.')
    }
})

const QUA_KHOA_QUAN_TRI = new Set(['GET /ket-noi', 'POST /ket-noi/thu', 'POST /soi', 'POST /do-tho', 'GET /gui/cai-dat', 'GET /gui/gan-day'])

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
        if (!laNgay(tu) || !laNgay(den) || den < tu) { res.status(400).json({ success: false, error: 'Ngày phải dạng YYYY-MM-DD, "đến" không trước "từ"' }); return }
        if ((Date.parse(den) - Date.parse(tu)) / 86_400_000 + 1 > SOI_TOI_DA_NGAY) { res.status(400).json({ success: false, error: `Soi tối đa ${SOI_TOI_DA_NGAY} ngày một lần` }); return }

        const kn = await docKetNoi(req.storePrisma)
        if (!kn) { res.status(400).json({ success: false, error: 'Cửa hàng chưa nhập kết nối meInvoice' }); return }
        const ph = await dsHoaDonPhatHanh(req.storePrisma, kn, tu, den)
        const tho = ph.tho
        const hoaDons = tho.map(docHoaDon)
        // danh sách tích hợp chỉ có HĐ ĐÃ PHÁT HÀNH; trạng thái cấp mã / xoá / thay thế từng HĐ sẽ hỏi lại MISA ngay trước khi gửi.
        // xemTruocGui giữ thứ tự ⇒ dòng i là hoá đơn i
        const { dong, dem } = await xemTruocGui(req.storePrisma, hoaDons, true)

        // Không để "0 hoá đơn" che chuyện đọc hỏng
        const canhBao: string[] = []
        if (ph.khongDocDuoc.length) {
            const k = ph.khongDocDuoc
            canhBao.push(`MISA trả dữ liệu Kengi chưa đọc được ở ${k.length} ngày (${k.slice(0, 3).map(x => `${x.ngay}: ${x.hinh}`).join('; ')}) — những ngày đó KHÔNG có nghĩa là không có hoá đơn.`)
        }
        for (const t of ph.thieu) canhBao.push(`Ngày ${t.ngay}: MISA báo ${t.misa} hoá đơn mà Kengi mới đọc được ${t.doc}.`)
        // Đã xếp gửi / lỗi / bỏ của từng hoá đơn (sổ MeInvoiceDaGui + hàng đợi Zalo)
        const gui = await trangThaiGuiNhieu(req.storePrisma, hoaDons.map(h => h.maTraCuu || ''))

        // Tên trường MISA trả về (đo tên thật — tài liệu không ghi đủ) + một bản ghi mẫu nguyên văn
        const truong = [...new Set(tho.flatMap(r => (r && typeof r === 'object' ? Object.keys(r) : [])))].sort()
        res.json({
            success: true,
            data: {
                tu, den, trangThai: 'phat_hanh', nhanTrangThai: 'Đã phát hành',
                tong: tho.length, ngayCat: ph.ngayCat,
                demNguon: ph.demNguon, nhanNguon: { thuong: NGUON_WEB.thuong.nhan, mtt: NGUON_WEB.mtt.nhan },
                canhBao,
                coMaTraCuu: hoaDons.filter(h => h.maTraCuu).length,
                truong, mau: tho[0] ?? null,
                dem, nhanKetQua: NHAN_KET_QUA,
                catDong: dong.length > SOI_TOI_DA_DONG,
                dong: dong.slice(0, SOI_TOI_DA_DONG).map((d, i) => ({
                    nguon: ph.dong[i]?.nguon ?? null,
                    refId: d.hoaDon.refId, kyHieu: d.hoaDon.kyHieu, so: d.hoaDon.so, ngay: d.hoaDon.ngay,
                    nguoiMua: d.hoaDon.tenNguoiMua, mst: d.hoaDon.mst, maKhach: d.hoaDon.maKhach, tongTien: d.hoaDon.tongTien,
                    coMaTraCuu: !!d.hoaDon.maTraCuu, maTraCuu: d.hoaDon.maTraCuu, trangThaiMisa: d.hoaDon.trangThai,
                    gui: d.hoaDon.maTraCuu ? gui.get(d.hoaDon.maTraCuu) ?? null : null,
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
        // trạng thái theo mã tra cứu (/invoice/status) — đo riêng, không cần ngày
        if (Array.isArray(b.maTraCuu) && b.maTraCuu.length) {
            const ma = b.maTraCuu.map((x: any) => String(x).trim()).filter((x: string) => /^[0-9A-Za-z_-]{4,40}$/.test(x)).slice(0, 20)
            if (!ma.length) { res.status(400).json({ success: false, error: 'maTraCuu không hợp lệ' }); return }
            const kn = await docKetNoi(req.storePrisma)
            if (!kn) { res.status(400).json({ success: false, error: 'Cửa hàng chưa nhập kết nối meInvoice' }); return }
            res.json({ success: true, data: { coMaDaLuu: kn.coMa, trangThaiHd: await doTrangThai(req.storePrisma, kn, ma, b.mayTinhTien === true) } })
            return
        }
        // link xem chính thức (/invoice/publishview) — trả HÌNH + tên miền, KHÔNG trả link (link xem được hoá đơn)
        if (typeof b.xemLink === 'string' && b.xemLink) {
            const ma = String(b.xemLink).trim()
            if (!/^[0-9A-Za-z_-]{4,40}$/.test(ma)) { res.status(400).json({ success: false, error: 'xemLink (mã tra cứu) không hợp lệ' }); return }
            const kn = await docKetNoi(req.storePrisma)
            if (!kn) { res.status(400).json({ success: false, error: 'Cửa hàng chưa nhập kết nối meInvoice' }); return }
            const { status, tv, text } = await goiApiTho(req.storePrisma, kn, 'tichHop', '/invoice/publishview', [ma])
            let xem: { ok: boolean; tenMien?: string; loi?: string } = { ok: false }
            if (tv.ok) { try { xem = { ok: true, tenMien: new URL(docLinkXem(tv.data, ma)).hostname } } catch (e: any) { xem = { ok: false, loi: e.message } } }
            const d = Array.isArray(tv.data) ? tv.data[0] : tv.data
            res.json({
                success: true, data: {
                    httpStatus: status, ok: tv.ok, loi: tv.loi || null, hinh: tv.ok ? moTaHinh(tv.data) : null,
                    truong: d && typeof d === 'object' ? Object.keys(d).sort() : null, xem, tho: tv.ok ? null : String(text || '').slice(0, 400),
                },
            })
            return
        }
        // tải thử PDF (/invoice/Download) — chỉ trả HÌNH + có phải PDF không, KHÔNG trả tệp
        if (typeof b.taiPdf === 'string' && b.taiPdf) {
            const ma = String(b.taiPdf).trim()
            if (!/^[0-9A-Za-z_-]{4,40}$/.test(ma)) { res.status(400).json({ success: false, error: 'taiPdf (mã tra cứu) không hợp lệ' }); return }
            const kn = await docKetNoi(req.storePrisma)
            if (!kn) { res.status(400).json({ success: false, error: 'Cửa hàng chưa nhập kết nối meInvoice' }); return }
            const duong = `/invoice/Download?downloadDataType=Pdf&invoiceWithCode=${kn.coMa ? 'true' : 'false'}&invoiceCalcu=${b.mayTinhTien === true ? 'true' : 'false'}`
            const { status, tv, text } = await goiApiTho(req.storePrisma, kn, 'tichHop', duong, [ma])
            let pdf: { ok: boolean; dai?: number; loi?: string } = { ok: false }
            if (tv.ok) { try { pdf = { ok: true, dai: docPdf(tv.data, ma).length } } catch (e: any) { pdf = { ok: false, loi: e.message } } }
            const d = Array.isArray(tv.data) ? tv.data[0] : tv.data
            res.json({
                success: true, data: {
                    duong: duong.split('?')[0], httpStatus: status, ok: tv.ok, loi: tv.loi || null, hinh: tv.ok ? moTaHinh(tv.data) : null,
                    truong: d && typeof d === 'object' ? Object.keys(d).sort() : null, pdf, tho: tv.ok ? null : String(text || '').slice(0, 400),
                },
            })
            return
        }
        const tu = String(b.tu || '')
        const den = b.den ? String(b.den) : tu
        const trangThai = b.trangThai === undefined ? '6' : String(b.trangThai)
        const sai = (t: any, d: any) => !laNgay(t) || !laNgay(d) || d < t || soNgay(t, d) > DO_TOI_DA_NGAY
        if (sai(tu, den)) { res.status(400).json({ success: false, error: `Ngày dạng YYYY-MM-DD, "đến" không trước "từ", tối đa ${DO_TOI_DA_NGAY} ngày` }); return }
        if (!TRANG_THAI_WEB[trangThai]) { res.status(400).json({ success: false, error: 'trangThai phải là 0, 4, 6 hoặc 7' }); return }

        // mặc định: cả khoảng MỘT lần, 3 bản ghi — web thường có mã / không mã / máy tính tiền / danh sách tích hợp (theo ký hiệu)
        const goc = { trangThai, tu, den, start: 0, length: 3 }
        let bienThe: BienTheDo[] = [
            { nguon: 'thuong', coMa: true, ...goc },
            { nguon: 'thuong', coMa: false, ...goc },
            { nguon: 'mtt', coMa: true, ...goc },
            { nguon: 'tichHop', coMa: true, ...goc },
        ]
        if (Array.isArray(b.bienThe) && b.bienThe.length) {
            if (b.bienThe.length > 8) { res.status(400).json({ success: false, error: 'Tối đa 8 biến thể một lần' }); return }
            bienThe = b.bienThe.map((x: any) => ({
                nguon: x?.nguon === 'mtt' || x?.nguon === 'tichHop' ? x.nguon : 'thuong',
                kyHieu: Array.isArray(x?.kyHieu) ? x.kyHieu.map((k: any) => String(k).trim()).filter((k: string) => /^[0-9A-Z]{1,12}$/i.test(k)).slice(0, 10) : undefined,
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

// ─── Gửi hoá đơn qua nhóm Zalo (lib/guiHoaDonMisa.ts) ─────────────────────────

const nguoiCua = (req: AuthRequest) => String(req.user?.email || req.user?.userId || '')

/** Mã cửa hàng (cho link hoá đơn) theo schema của phiên đăng nhập */
async function maCuaHang(req: AuthRequest): Promise<string> {
    const { registryPrisma } = await import('../lib/prisma')
    const s: any = await (registryPrisma as any).store.findFirst({ where: { schema: req.user?.storeSchema }, select: { code: true } })
    if (!s?.code) throw new LoiMeInvoice('Không xác định được mã cửa hàng.')
    return String(s.code)
}

router.get('/gui/cai-dat', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const [cd, kenh] = await Promise.all([docCaiDat(req.storePrisma), moTaKenhZalo(req.storePrisma)])
        res.json({ success: true, data: { ...cd, mauMacDinh: MAU_MAC_DINH, bien: BIEN_HOA_DON, kenhZalo: kenh, lanTuDongToiDa: LAN_TU_DONG_TOI_DA } })
    } catch (e: any) { traLoi(res, e) }
})

router.put('/gui/cai-dat', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        const cd = await luuCaiDat(req.storePrisma, {
            tuDong: typeof b.tuDong === 'boolean' ? b.tuDong : undefined,
            mauTin: b.mauTin === undefined ? undefined : (b.mauTin === null ? null : String(b.mauTin)),
        }, nguoiCua(req))
        res.json({ success: true, data: cd })
    } catch (e: any) { traLoi(res, e) }
})

router.post('/gui', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        const ma = String(b.maTraCuu || '').trim()
        const ngay = String(b.ngay || '')
        if (!/^[0-9A-Za-z_-]{4,40}$/.test(ma) || !laNgay(ngay)) { res.status(400).json({ success: false, error: 'Cần mã tra cứu và ngày hoá đơn (YYYY-MM-DD)' }); return }
        const kq = await guiTay(req.storePrisma, await maCuaHang(req), ma, ngay, nguoiCua(req))
        const tt = (await trangThaiGuiNhieu(req.storePrisma, [ma])).get(ma) ?? null
        res.json({ success: true, data: { ...kq, gui: tt } })
    } catch (e: any) { traLoi(res, e) }
})

router.get('/gui/gan-day', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const ds = await dsGanDay(req.storePrisma, Number(req.query.gioiHan) || 30)
        const tt = await trangThaiGuiNhieu(req.storePrisma, ds.map(d => d.maTraCuu))
        res.json({
            success: true,
            data: ds.map(d => ({
                kyHieu: d.kyHieu, so: d.so, ngay: d.ngay, tongTien: d.tongTien, maKhach: d.maKhach, soNhom: d.soNhom,
                nguon: d.nguon, nguoi: d.nguoi, capNhatLuc: d.capNhatLuc, gui: tt.get(d.maTraCuu) ?? null,
            })),
        })
    } catch (e: any) { traLoi(res, e) }
})

export default router
