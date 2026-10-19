/**
 * ĐẨY HOÁ ĐƠN SANG MISA — route CỬA HÀNG cho trang Vận Hành › "Đẩy HĐ sang MISA" (19/10/2026, chủ shop yêu cầu)
 *
 * Trước đây chiều đẩy (services/misaPush.ts) chỉ có trong /admin (khoá quản trị, routes/misa.ts). Trang này cho chính cửa hàng
 * (đăng nhập thường, phân quyền nhóm "Hóa đơn ĐT") làm ba việc:
 *   1. Đẩy hoá đơn: chứng từ bán hàng (voucher 13) lên MISA AMIS — mặc định CHỈ phiếu khách yêu cầu hoá đơn (layHoaDon,
 *      /hoadon nhóm Zalo) vì hoá đơn của Hưng Tín xuất bên MISA. Kế hoạch luôn dựng lại phía máy chủ; trình duyệt chỉ gửi id.
 *   2. Liên kết hàng hoá: nối hàng Kengi ↔ vật tư MISA (lib/misaLienKet.ts) — mã HUTI đến từ KiotViet, phần lớn không trùng MISA.
 *   3. Kết nối & thiết lập: tài khoản MISA của CHÍNH cửa hàng (chủ shop tự nhập), chi nhánh / kho / khách lẻ MISA.
 *
 * Quyền: xem = einvoice.view · đẩy = einvoice.issue | einvoice.batch_issue · nối hàng, tạo vật tư, kết nối = einvoice.config.
 * MISA xử lý BẤT ĐỒNG BỘ — gửi xong là "đề nghị", kế toán duyệt bên MISA; tra kết quả bằng "Hỏi kết quả".
 */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { errMsg } from '../lib/errorResponse'
import { MISA, testMisaConnection, clearMisaToken, type MisaCreds } from '../services/misa'
import { docCaiDat, docDanhMucMisa, quenDanhMuc, lapKeHoach, guiDi, hoiKetQua, type DongKeHoach } from '../services/misaPush'
import {
    dungChiMuc, goiYVatTu, timVatTu, trangThaiLienKet, noiHang, boNoiHang, nhapLienKetPrtcode, boDau,
    type ChiMucMisa, type DongNhap,
} from '../lib/misaLienKet'

const router = Router()
router.use(authMiddleware)

const XEM = requirePermission('einvoice.view')
const DAY = requirePermission('einvoice.issue', 'einvoice.batch_issue')
const CAU_HINH = requirePermission('einvoice.config')

const schemaCua = (req: AuthRequest) => String(req.user?.branchSchema || req.user?.storeSchema || '')
/** Không nuốt lỗi: đọc cấu hình hỏng ≠ "chưa kết nối" */
const docCauHinh = (sp: any) => sp.misaConfig.findUnique({ where: { id: 'default' } })

function credsOf(cfg: any): MisaCreds {
    return {
        appId: String(cfg.appId || '').trim(),
        accessCode: String(cfg.accessCode || '').trim(),
        orgCompanyCode: String(cfg.orgCompanyCode || '').trim(),
        baseUrl: cfg.baseUrl ? String(cfg.baseUrl).trim() : undefined,
        clientId: cfg.clientId ? String(cfg.clientId).trim() : undefined,
        clientSecret: cfg.clientSecret ? String(cfg.clientSecret).trim() : undefined,
    }
}

/** Lỗi TỪ MISA hiện nguyên văn (người vận hành cần đọc) — lỗi nội bộ thì gọn */
const loiMisa = (e: any) => (e?.name === 'MisaError' && e?.message ? String(e.message).slice(0, 400) : errMsg(e))
const tra500 = (res: Response, e: any) => {
    console.error('[misa-day]', e?.message || e)
    res.status(500).json({ success: false, error: loiMisa(e) })
}

/** Cấu hình + thông tin đăng nhập MISA; chưa kết nối ⇒ trả 400 rồi null */
async function canKetNoi(req: AuthRequest, res: Response) {
    const sp: any = req.storePrisma
    const cfg = await docCauHinh(sp)
    if (!cfg) { res.status(400).json({ success: false, error: 'Cửa hàng chưa kết nối MISA — vào tab "Kết nối & thiết lập"' }); return null }
    return { sp, cfg, creds: credsOf(cfg), schema: schemaCua(req) }
}

/** Danh mục MISA (vật tư/đối tượng/kho/chi nhánh) — lấy trọn bộ, nhớ 10 phút theo cửa hàng. Lần đầu có thể mất 10–60 giây. */
const chiMuc = new Map<string, { layLuc: number; cm: ChiMucMisa }>()
async function danhMuc(kn: { creds: MisaCreds; schema: string }, lamMoi = false) {
    const dm = await docDanhMucMisa(kn.creds, kn.schema, lamMoi)
    let c = chiMuc.get(kn.schema)
    if (!c || c.layLuc !== dm.layLuc) { c = { layLuc: dm.layLuc, cm: dungChiMuc(dm) }; chiMuc.set(kn.schema, c) }
    return { dm, cm: c.cm }
}

/** 'yyyy-mm-dd' giờ VN → [đầu ngày, cuối ngày] */
function khoangNgayVN(tu: any, den: any): { tu: Date; den: Date } | null {
    const re = /^\d{4}-\d{2}-\d{2}$/
    if (!re.test(String(tu)) || !re.test(String(den))) return null
    const a = new Date(`${tu}T00:00:00+07:00`), b = new Date(`${den}T23:59:59.999+07:00`)
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || a > b) return null
    if (b.getTime() - a.getTime() > 92 * 86400_000) return null   // tối đa ~3 tháng/lượt (trần 2.000 phiếu của kế hoạch)
    return { tu: a, den: b }
}

/** Bỏ payload (thân chứng từ, nặng) trước khi trả về trình duyệt */
const goiDong = (d: DongKeHoach) => ({
    localId: d.localId, refNo: d.refNo, ngay: d.ngay, doiTuong: d.doiTuong, soTien: d.soTien,
    trangThai: d.trangThai, lyDo: d.lyDo, canhBao: d.canhBao, lanTruoc: d.lanTruoc,
    soDong: Array.isArray(d.payload?.detail) ? d.payload.detail.length : null,
})

// ─── Cấu hình ───────────────────────────────────────────────────────────────

router.get('/cau-hinh', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const sp: any = req.storePrisma
        const cfg = await docCauHinh(sp)
        const so: any[] = await sp.misaPushItem.groupBy({ by: ['trangThai'], where: { loai: 'banhang' }, _count: { _all: true } })
        const lienKet = await sp.misaMap.count({ where: { entity: 'product' } })
        res.json({ success: true, data: {
            coKetNoi: !!cfg,
            congMoi: !!cfg?.clientId,
            // mã nhận diện che bớt; bí mật (access code, client secret, mã công ty) chỉ báo đã đặt hay chưa
            clientId: cfg?.clientId ? `${String(cfg.clientId).slice(0, 8)}…` : '',
            appId: cfg?.appId ? `${String(cfg.appId).slice(0, 6)}…` : '',
            daDatAccessCode: !!cfg?.accessCode, daDatClientSecret: !!cfg?.clientSecret, daDatMaCongTy: !!cfg?.orgCompanyCode,
            thietLap: docCaiDat(cfg?.pushConfig),
            soHoaDon: Object.fromEntries(so.map(r => [r.trangThai, r._count._all])),
            soLienKet: lienKet,
        } })
    } catch (e: any) { tra500(res, e) }
})

/** Chủ shop nhập tài khoản MISA. Bí mật để TRỐNG = giữ nguyên. `xoaClientId` = quay về cổng cũ (App ID). */
router.put('/ket-noi', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const sp: any = req.storePrisma
        const b = req.body || {}
        const cu = await docCauHinh(sp)
        const data: any = {}
        const dat = (k: string, v: any) => { if (typeof v === 'string' && v.trim()) data[k] = v.trim() }
        dat('appId', b.appId); dat('accessCode', b.accessCode); dat('orgCompanyCode', b.orgCompanyCode)
        dat('clientId', b.clientId); dat('clientSecret', b.clientSecret)
        if (b.xoaClientId === true) { data.clientId = null; data.clientSecret = null }
        if (!Object.keys(data).length) { res.status(400).json({ success: false, error: 'Chưa nhập gì để lưu' }); return }
        if (cu) {
            clearMisaToken(credsOf(cu))
            quenDanhMuc(schemaCua(req)); chiMuc.delete(schemaCua(req))
            await sp.misaConfig.update({ where: { id: 'default' }, data })
        } else {
            if ((!data.appId && !data.clientId) || !data.accessCode || !data.orgCompanyCode) {
                res.status(400).json({ success: false, error: 'Lần đầu phải nhập đủ Client ID (cổng mới developer.misa.vn) hoặc App ID (cổng cũ), Access Code và Mã công ty' })
                return
            }
            // enabled = false: cờ này điều khiển KÉO từ MISA về (routes/misa.ts) — trang đẩy không bật hộ
            await sp.misaConfig.create({ data: { id: 'default', appId: '', enabled: false, ...data } })
        }
        res.json({ success: true })
    } catch (e: any) { tra500(res, e) }
})

router.post('/thu-ket-noi', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const r = await testMisaConnection(kn.creds)
        res.json({ success: r.ok, data: r, error: r.ok ? undefined : r.error })
    } catch (e: any) { tra500(res, e) }
})

/** Chi nhánh + kho MISA cho ô chọn ở Thiết lập; số vật tư / đối tượng để biết danh mục đọc đủ chưa */
router.get('/danh-muc-misa', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const { dm } = await danhMuc(kn, req.query.lamMoi === '1')
        res.json({ success: true, data: {
            chiNhanh: dm.chiNhanh, kho: dm.kho, soVatTu: dm.vatTuTheoMa.size, soDoiTuong: dm.doiTuongTheoMa.size,
            layLuc: new Date(dm.layLuc).toISOString(), canhBao: dm.canhBao,
        } })
    } catch (e: any) { tra500(res, e) }
})


/** Thiết lập đẩy: GỘP lên bản đang lưu (gửi thiếu khoá không làm mất khoá cũ) */
router.put('/thiet-lap', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const moi = req.body?.thietLap
        if (!moi || typeof moi !== 'object') { res.status(400).json({ success: false, error: 'Thiếu thietLap' }); return }
        const cu = docCaiDat(kn.cfg.pushConfig)
        const gop = { ...cu, ...moi, tk: { ...cu.tk, ...(moi.tk || {}) } }
        const chuan = docCaiDat(JSON.stringify(gop))
        await kn.sp.misaConfig.update({ where: { id: 'default' }, data: { pushConfig: JSON.stringify(chuan) } })
        res.json({ success: true, data: chuan })
    } catch (e: any) { tra500(res, e) }
})

// ─── Đẩy hoá đơn ────────────────────────────────────────────────────────────

router.post('/hoa-don/xem-truoc', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const k = khoangNgayVN(req.body?.tu, req.body?.den)
        if (!k) { res.status(400).json({ success: false, error: 'Khoảng ngày không hợp lệ (yyyy-mm-dd, tối đa 3 tháng)' }); return }
        const { dm } = await danhMuc(kn)
        const kq = await lapKeHoach(kn.sp, kn.creds, docCaiDat(kn.cfg.pushConfig), dm, {
            loai: 'banhang', tu: k.tu, den: k.den, schema: kn.schema, chiLayHoaDon: req.body?.chiLayHoaDon !== false,
        })
        res.json({ success: true, data: { ...kq, dong: kq.dong.map(goiDong) } })
    } catch (e: any) { tra500(res, e) }
})

/** Gửi ĐÚNG các phiếu người dùng chọn — kế hoạch dựng lại từ DB, chỉ dòng "sẵn sàng" mới đi */
router.post('/hoa-don/gui', DAY, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const k = khoangNgayVN(req.body?.tu, req.body?.den)
        const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 500) : []
        if (!k || !ids.length) { res.status(400).json({ success: false, error: 'Thiếu khoảng ngày hoặc chưa chọn phiếu' }); return }
        const { dm } = await danhMuc(kn)
        const kh = await lapKeHoach(kn.sp, kn.creds, docCaiDat(kn.cfg.pushConfig), dm, {
            loai: 'banhang', tu: k.tu, den: k.den, schema: kn.schema, chiLayHoaDon: req.body?.chiLayHoaDon !== false, ids,
        })
        const sanSang = kh.dong.filter(d => d.trangThai === 'san_sang')
        const boQua = kh.dong.filter(d => d.trangThai !== 'san_sang').map(d => ({ refNo: d.refNo, trangThai: d.trangThai, lyDo: d.lyDo.join('; ') }))
        if (!sanSang.length) { res.json({ success: true, data: { daGui: 0, loi: [], boQua } }); return }
        const kq = await guiDi(kn.sp, kn.creds, 'banhang', sanSang)
        res.json({ success: true, data: { daGui: kq.daGui, loi: kq.loi, boQua } })
    } catch (e: any) { tra500(res, e) }
})

/** Kết quả MISA xử lý đề nghị — tu/den là NGÀY GỬI (không phải ngày chứng từ), YYYY-MM-DD như MISA nhận */
router.post('/hoa-don/ket-qua', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        if (!khoangNgayVN(req.body?.tu, req.body?.den)) { res.status(400).json({ success: false, error: 'Khoảng ngày gửi không hợp lệ (yyyy-mm-dd, tối đa 3 tháng)' }); return }
        const kq = await hoiKetQua(kn.sp, kn.creds, String(req.body.tu), String(req.body.den))
        res.json({ success: true, data: kq })
    } catch (e: any) { tra500(res, e) }
})

/** Xoá ĐỀ NGHỊ đã đẩy (chưa được kế toán "Lập CT kế toán" bên MISA) để gửi lại — vd đổi mẫu chứng từ (19/10/2026).
 *  Từng phiếu một: phiếu đã thành chứng từ thì MISA từ chối — câu lỗi MISA trả về nguyên văn, phiếu khác vẫn xoá tiếp. */
router.post('/hoa-don/xoa-de-nghi', DAY, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 100) : []
        if (!ids.length) { res.status(400).json({ success: false, error: 'Chưa chọn phiếu' }); return }
        /* `chiBoQua`: KHÔNG gọi MISA, chỉ bỏ dấu "đã đẩy" để gửi lại — khi đề nghị cũ không có bên MISA (đi qua kết nối KHÁC: HUTI
         * 19/10 gửi qua cổng mới Client ID trong khi MISA đang nhận theo App ID cũ ⇒ không thấy, xoá qua kết nối mới cũng vô nghĩa).
         * Người dùng tự xác nhận đã soát "Đề nghị lập chứng từ kế toán" bên MISA; MISA nhận trùng org_refid thì tự báo. */
        const chiBoQua = req.body?.chiBoQua === true
        const rows: any[] = await kn.sp.misaPushItem.findMany({ where: { loai: 'banhang', localId: { in: ids } } })
        const ketQua: Array<{ refNo: string; ok: boolean; loi?: string }> = []
        for (const r of rows) {
            if (r.trangThai === 'da_xoa') { ketQua.push({ refNo: r.refNo, ok: true }); continue }
            if (chiBoQua) {
                await kn.sp.misaPushItem.update({ where: { id: r.id }, data: { trangThai: 'da_xoa', loi: 'Bỏ qua lần đẩy trước (không thấy bên MISA) — gửi lại', ketQuaLuc: new Date() } })
                ketQua.push({ refNo: r.refNo, ok: true })
                continue
            }
            try {
                await MISA.xoaDeNghi(kn.creds, [{ voucher_type: r.voucherType || 13, org_refid: r.orgRefid }])
                await kn.sp.misaPushItem.update({ where: { id: r.id }, data: { trangThai: 'da_xoa', loi: null, ketQuaLuc: new Date() } })
                ketQua.push({ refNo: r.refNo, ok: true })
            } catch (e: any) {
                ketQua.push({ refNo: r.refNo, ok: false, loi: loiMisa(e) })
            }
        }
        res.json({ success: true, data: { ketQua } })
    } catch (e: any) { tra500(res, e) }
})

/** Sổ các lần đẩy hoá đơn (MisaPushItem loai 'banhang'), mới nhất trước */
router.get('/hoa-don/so', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const sp: any = req.storePrisma
        const trang = Math.max(1, Number(req.query.trang) || 1)
        const where: any = { loai: 'banhang' }
        if (typeof req.query.trangThai === 'string' && req.query.trangThai) where.trangThai = req.query.trangThai
        // tuần tự — pool prod mỗi cửa hàng 1 kết nối (prisma-pool-promiseall-trap)
        const tong = await sp.misaPushItem.count({ where })
        const banGhi = await sp.misaPushItem.findMany({
            where, orderBy: { guiLuc: 'desc' }, skip: (trang - 1) * 50, take: 50,
            select: { id: true, localId: true, refNo: true, ngay: true, soTien: true, trangThai: true, loi: true, lanGui: true, guiLuc: true, ketQuaLuc: true },
        })
        res.json({ success: true, data: { tong, trang, ds: banGhi } })
    } catch (e: any) { tra500(res, e) }
})

// ─── Liên kết hàng hoá ──────────────────────────────────────────────────────

/** id hàng theo phạm vi: hàng có trong phiếu Lấy HĐ / hàng đã bán trong N ngày / tất cả */
async function idHangTheoPhamVi(sp: any, phamVi: string, ngay: number): Promise<string[] | null> {
    if (phamVi === 'tat-ca') return null
    const tu = new Date(Date.now() - ngay * 86400_000)
    const rows: any[] = await sp.$queryRawUnsafe(
        `SELECT DISTINCT ti."productId" AS id FROM "TransactionItem" ti
           JOIN "Transaction" t ON t."id" = ti."transactionId"
          WHERE t."status" IN ('completed','partial') AND COALESCE(t."transactionDate", t."createdAt") >= $1
            ${phamVi === 'lay-hd' ? 'AND t."layHoaDon" = true' : ''}`, tu)
    return rows.map(r => String(r.id))
}

router.get('/lien-ket', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const { dm, cm } = await danhMuc(kn)
        const phamVi = ['lay-hd', 'da-ban', 'tat-ca'].includes(String(req.query.phamVi)) ? String(req.query.phamVi) : 'da-ban'
        const ngay = Math.min(365, Math.max(7, Number(req.query.ngay) || 90))
        const loc = String(req.query.loc || 'chua')
        const q = boDau(String(req.query.q || '').trim())
        const trang = Math.max(1, Number(req.query.trang) || 1)

        const ids = await idHangTheoPhamVi(kn.sp, phamVi, ngay)
        const hang: any[] = await kn.sp.product.findMany({
            where: ids ? { id: { in: ids } } : { mergedIntoId: null },
            select: { id: true, sku: true, name: true, baseUnit: true },
            orderBy: { name: 'asc' },
        })
        const lk = await trangThaiLienKet(kn.sp, dm, hang)
        const dem = { tong: hang.length, noi: 0, trungMa: 0, chua: 0, noiHong: 0 }
        for (const h of hang) {
            const k = lk.get(h.id)!.kieu
            if (k === 'noi') dem.noi++; else if (k === 'trung-ma') dem.trungMa++; else if (k === 'noi-hong') dem.noiHong++; else dem.chua++
        }
        const loc_ = hang.filter(h => {
            const k = lk.get(h.id)!.kieu
            if (loc === 'chua' && !(k === 'chua' || k === 'noi-hong')) return false
            if (loc === 'noi' && k !== 'noi') return false
            if (loc === 'trung-ma' && k !== 'trung-ma') return false
            if (q && !boDau(`${h.sku} ${h.name}`).includes(q)) return false
            return true
        })
        const trangDs = loc_.slice((trang - 1) * 50, trang * 50)
        const dong = trangDs.map(h => {
            const l = lk.get(h.id)!
            return {
                id: h.id, sku: h.sku, ten: h.name, dvt: h.baseUnit,
                kieu: l.kieu, misa: l.vt ? { ma: l.vt.ma, ten: l.vt.ten, dvt: l.vt.dvt, ngung: !!l.vt.ngung } : null,
                maDaNoi: l.maDaNoi ?? null,
                goiY: l.kieu === 'chua' || l.kieu === 'noi-hong' ? goiYVatTu(cm, h.name, h.sku) : [],
            }
        })
        res.json({ success: true, data: { dem, tongLoc: loc_.length, trang, soTrang: Math.max(1, Math.ceil(loc_.length / 50)), dong, soVatTuMisa: dm.vatTuTheoMa.size } })
    } catch (e: any) { tra500(res, e) }
})

router.get('/vat-tu-misa', XEM, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const { cm } = await danhMuc(kn)
        res.json({ success: true, data: timVatTu(cm, String(req.query.q || ''), 30) })
    } catch (e: any) { tra500(res, e) }
})

/** Nối / bỏ nối một hàng. maMisa null = bỏ nối. Vật tư đang nối hàng khác ⇒ 409 kèm hàng đó, gửi lại `chuyen: true` để chuyển. */
router.put('/lien-ket', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const productId = String(req.body?.productId || '')
        if (!productId) { res.status(400).json({ success: false, error: 'Thiếu productId' }); return }
        if (req.body?.maMisa === null) {
            const n = await boNoiHang(kn.sp, productId)
            res.json({ success: true, data: { daBo: n } }); return
        }
        const { dm } = await danhMuc(kn)
        const kq = await noiHang(kn.sp, dm, productId, String(req.body?.maMisa || ''), req.body?.chuyen === true)
        if (!kq.ok) { res.status(kq.xungDot ? 409 : 400).json({ success: false, error: kq.loi, xungDot: kq.xungDot }); return }
        res.json({ success: true, data: { ma: kq.vt.ma, ten: kq.vt.ten, daChuyenTu: kq.daChuyenTu ?? null } })
    } catch (e: any) { tra500(res, e) }
})

/** Nhập liên kết cũ: [{maMisa, maKv}] từ cột code + PRTCODE của tab "Product n8n" (trình duyệt đọc Excel). Mặc định CHẠY THỬ. */
router.post('/lien-ket/nhap', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const dong = Array.isArray(req.body?.dong) ? req.body.dong.slice(0, 20000) : []
        if (!dong.length) { res.status(400).json({ success: false, error: 'File không có dòng nào' }); return }
        const { dm } = await danhMuc(kn)
        const apply = req.body?.apply === true
        const kq = await nhapLienKetPrtcode(kn.sp, dm, dong, { apply, ghiDe: req.body?.ghiDe === true })
        res.json({ success: true, cheDo: apply ? 'GHI THẬT' : 'CHẠY THỬ', data: { dem: kq.dem, mau: kq.ds.filter((dn: DongNhap) => dn.viec !== 'giu-nguyen' && dn.viec !== 'trung-ma-san').slice(0, 200) } })
    } catch (e: any) { tra500(res, e) }
})

/** Tạo vật tư MỚI trên MISA cho hàng chưa có (mã = SKU Kengi). `apply` mới gửi; không thì chỉ trả kế hoạch. */
router.post('/vat-tu/tao', CAU_HINH, async (req: AuthRequest, res: Response) => {
    try {
        const kn = await canKetNoi(req, res); if (!kn) return
        const ids: string[] = Array.isArray(req.body?.productIds) ? req.body.productIds.map(String).slice(0, 200) : []
        if (!ids.length) { res.status(400).json({ success: false, error: 'Chưa chọn hàng' }); return }
        const { dm } = await danhMuc(kn)
        const kh = await lapKeHoach(kn.sp, kn.creds, docCaiDat(kn.cfg.pushConfig), dm, {
            loai: 'vattu', tu: new Date(0), den: new Date(), schema: kn.schema, ids,
        })
        const sanSang = kh.dong.filter(d => d.trangThai === 'san_sang')
        if (req.body?.apply !== true) { res.json({ success: true, cheDo: 'CHẠY THỬ', data: { ...kh, dong: kh.dong.map(goiDong) } }); return }
        const kq = sanSang.length ? await guiDi(kn.sp, kn.creds, 'vattu', sanSang) : { daGui: 0, loi: [], xuLy: [] }
        // danh mục MISA đổi ⇒ đọc lại ở lần sau
        quenDanhMuc(kn.schema); chiMuc.delete(kn.schema)
        res.json({ success: true, cheDo: 'GHI THẬT', data: { daGui: kq.daGui, loi: kq.loi, boQua: kh.dong.filter(d => d.trangThai !== 'san_sang').map(goiDong) } })
    } catch (e: any) { tra500(res, e) }
})

export default router
