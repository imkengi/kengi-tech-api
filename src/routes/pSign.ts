/**
 * /api/p-sign — ký tài liệu PDF bằng chữ ký số từ xa MISA eSign (11/11/2026). Xem lib/pSign.ts.
 *
 *   GET    /trang-thai        kết nối của cửa hàng (không bí mật) + phiên eSign của người đang dùng     einvoice.view
 *   PUT    /ket-noi           {clientId, clientSecret} — Client Secret để trống = giữ nguyên            einvoice.config
 *   DELETE /ket-noi           xoá kết nối + mọi phiên eSign                                            einvoice.config
 *   POST   /dang-nhap         {taiKhoan, matKhau} tài khoản MISA eSign CỦA NGƯỜI ĐANG DÙNG — không lưu mật khẩu
 *   POST   /otp               {taiKhoan, ma, loaiOtp}     · POST /otp/gui-lai {taiKhoan}
 *   POST   /dang-xuat         xoá phiên eSign của người đang dùng
 *   GET    /chung-thu         chứng thư số của tài khoản eSign đang đăng nhập
 *   POST   /ky                {tenTep, pdf, certAlias, viTri, hienThi} băm + gửi yêu cầu ký ⇒ chờ bấm trên app MISA eSign
 *   GET    /ky/:transactionId trạng thái ký (cho | xong | loi)
 *   POST   /hoan-tat          {transactionId, nhatKyId, certAlias, docBam} gắn chữ ký ⇒ trả PDF đã ký
 *   GET    /nhat-ky           50 lượt ký gần nhất của cửa hàng (không có nội dung tệp)
 * Mọi đường (trừ kết nối) cần einvoice.view. Phiên eSign theo TỪNG người dùng Kengi: người này không ký được bằng phiên người kia.
 * JWT đổi từ API key không có người thật đứng sau ⇒ không cho đăng nhập / ký.
 */

import { Router, Response, NextFunction } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { errMsg } from '../lib/errorResponse'
import {
    LoiPSign, trangThai, luuKetNoi, xoaKetNoi, dangNhap, xacThucOtp, guiLaiOtp, xoaPhien, dsChungThu, chungThuGon,
    batDauKy, hoiTrangThai, hoanTat, dsNhatKy,
} from '../lib/pSign'

const router = Router()
router.use(authMiddleware)

const XEM = requirePermission('einvoice.view')
const CAU_HINH = requirePermission('einvoice.config')

/** Lỗi của MISA / lỗi nhập liệu hiện NGUYÊN VĂN kèm `ma`; MISA sập ⇒ 502; lỗi nội bộ thì gọn. Không bao giờ trả 401 (FE coi 401 là hết phiên Kengi). */
function traLoi(res: Response, e: any) {
    if (e instanceof LoiPSign) {
        const s = e.httpStatus
        const code = s === 404 ? 404 : s === 409 ? 409 : s && s >= 500 ? 502 : 400
        res.status(code).json({ success: false, error: e.message, ...(e.ma ? { ma: e.ma } : {}) })
        return
    }
    console.error('[p-sign]', e?.message || e)
    res.status(500).json({ success: false, error: errMsg(e) })
}

/** Người thật: có userId và không phải JWT của API key */
function nguoiThat(req: AuthRequest, res: Response, next: NextFunction) {
    if (!req.user?.userId || req.user.apiKeyScopes !== undefined) {
        res.status(403).json({ success: false, error: 'P-Sign cần người dùng đăng nhập trực tiếp — không dùng được bằng API key.' })
        return
    }
    next()
}

const uid = (req: AuthRequest) => String(req.user!.userId)
const nguoi = (req: AuthRequest) => String(req.user?.email || req.user?.userId || '')

router.get('/trang-thai', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try { res.json({ success: true, data: await trangThai(req.storePrisma, uid(req)) }) } catch (e: any) { traLoi(res, e) }
})

router.put('/ket-noi', CAU_HINH, nguoiThat, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        await luuKetNoi(req.storePrisma, { clientId: b.clientId, clientSecret: b.clientSecret }, nguoi(req))
        res.json({ success: true, data: await trangThai(req.storePrisma, uid(req)) })
    } catch (e: any) { traLoi(res, e) }
})

router.delete('/ket-noi', CAU_HINH, nguoiThat, async (req: AuthRequest, res: Response) => {
    try { res.json({ success: true, data: { daXoa: await xoaKetNoi(req.storePrisma) } }) } catch (e: any) { traLoi(res, e) }
})

router.post('/dang-nhap', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        res.json({ success: true, data: await dangNhap(req.storePrisma, uid(req), b.taiKhoan, b.matKhau) })
    } catch (e: any) { traLoi(res, e) }
})

router.post('/otp', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        res.json({ success: true, data: await xacThucOtp(req.storePrisma, uid(req), b.taiKhoan, b.ma, Number(b.loaiOtp)) })
    } catch (e: any) { traLoi(res, e) }
})

router.post('/otp/gui-lai', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try { res.json({ success: true, data: await guiLaiOtp(req.storePrisma, (req.body || {}).taiKhoan) }) } catch (e: any) { traLoi(res, e) }
})

router.post('/dang-xuat', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try { await xoaPhien(req.storePrisma, uid(req)); res.json({ success: true, data: { daDangXuat: true } }) } catch (e: any) { traLoi(res, e) }
})

router.get('/chung-thu', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try { res.json({ success: true, data: (await dsChungThu(req.storePrisma, uid(req))).map(chungThuGon) }) } catch (e: any) { traLoi(res, e) }
})

router.post('/ky', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        res.json({ success: true, data: await batDauKy(req.storePrisma, { userId: uid(req), nguoi: nguoi(req) }, { tenTep: b.tenTep, pdf: b.pdf, certAlias: b.certAlias, viTri: b.viTri, hienThi: b.hienThi }) })
    } catch (e: any) { traLoi(res, e) }
})

router.get('/ky/:transactionId', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: await hoiTrangThai(req.storePrisma, uid(req), String(req.params.transactionId || ''), req.query.nhatKyId ? String(req.query.nhatKyId) : undefined) })
    } catch (e: any) { traLoi(res, e) }
})

router.post('/hoan-tat', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        res.json({ success: true, data: await hoanTat(req.storePrisma, uid(req), { transactionId: b.transactionId, nhatKyId: b.nhatKyId, certAlias: b.certAlias, docBam: b.docBam }) })
    } catch (e: any) { traLoi(res, e) }
})

router.get('/nhat-ky', XEM, nguoiThat, async (req: AuthRequest, res: Response) => {
    try { res.json({ success: true, data: await dsNhatKy(req.storePrisma) }) } catch (e: any) { traLoi(res, e) }
})

export default router
